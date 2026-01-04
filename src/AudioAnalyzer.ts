import type { AudioMode } from './audio'
import { frequencyToBinIndex } from './audio'

/**
 * Single musical / perceptual band definition.
 * All frequencies are inclusive in [minHz, maxHz].
 */
export interface FrequencyBand {
  id: string
  label: string
  minHz: number
  maxHz: number
}

export interface AnalyzerFrame {
  /**
   * Latest FFT magnitudes in decibels, one entry per analyser bin.
   * This is the raw data used by the spectrogram renderer.
   */
  fftMagnitudes: Float32Array

  /**
   * Per-band, temporally smoothed, normalized energy values in [0, 1].
   * These are intended for UI use (bar graphs, animations, etc.).
   */
  bands: number[]
}

export interface AudioAnalyzerOptions {
  /**
   * FFT size used by the analyser.
   * 2048 is a good compromise between frequency resolution and CPU cost:
   * at 44.1 kHz it gives about 21 Hz per bin.
   */
  fftSize?: number

  /**
   * Web Audio AnalyserNode smoothing factor for FFT magnitudes.
   * This is independent from the per-band smoothing below.
   */
  smoothingTimeConstant?: number

  /**
   * Decibel range for getFloatFrequencyData and normalization.
   */
  minDecibels?: number
  maxDecibels?: number

  /**
   * Optional override for the musical / perceptual bands.
   * If omitted, a 6-band “sub..brilliance” set is used.
   */
  bands?: FrequencyBand[]

  /**
   * Exponential smoothing factor for band values, in (0, 1].
   * Higher values react faster; lower values are smoother but laggy.
   */
  bandSmoothingAlpha?: number
}

interface InternalBandState {
  config: FrequencyBand
  startBin: number
  endBin: number
  smoothedValue: number
}

/**
 * AudioAnalyzer owns:
 * - A single AudioContext
 * - A shared AnalyserNode used for FFT
 * - Switching between file playback and microphone input
 * - Aggregation of FFT magnitudes into a small number of musical bands
 *
 * The UI interacts with it via:
 * - setSourceFromFile / setSourceFromMic (select input)
 * - start / pauseFile / stop (control playback or capture)
 * - getFrame (per-frame FFT + band data for visualization)
 */
export class AudioAnalyzer {
  private readonly audioContext: AudioContext
  private readonly analyser: AnalyserNode

  private readonly minDecibels: number
  private readonly maxDecibels: number

  private readonly bandSmoothingAlpha: number
  private readonly bandsInternal: InternalBandState[]

  private readonly fftMagnitudes: Float32Array

  private currentMode: AudioMode = 'idle'

  // File playback state
  private fileSource: AudioBufferSourceNode | null = null
  private fileBuffer: AudioBuffer | null = null
  private filePauseOffset = 0 // seconds into the buffer
  private fileStartTime = 0 // audioContext.currentTime when playback last started
  private fileName: string | null = null

  // Microphone state
  private micStream: MediaStream | null = null
  private micSource: MediaStreamAudioSourceNode | null = null

  constructor(options?: AudioAnalyzerOptions) {
    this.audioContext = new AudioContext()
    this.analyser = this.audioContext.createAnalyser()

    const fftSize = options?.fftSize ?? 2048
    this.analyser.fftSize = fftSize

    // Keep analyser smoothing relatively low so that FFT frames react
    // quickly to changes; most of the visible stability comes from the
    // per-band smoothing below.
    this.analyser.smoothingTimeConstant = options?.smoothingTimeConstant ?? 0.4

    this.minDecibels = options?.minDecibels ?? -100
    this.maxDecibels = options?.maxDecibels ?? -30

    this.analyser.minDecibels = this.minDecibels
    this.analyser.maxDecibels = this.maxDecibels

    this.fftMagnitudes = new Float32Array(this.analyser.frequencyBinCount)

    // Higher alpha -> bands react faster and represent a shorter time window.
    // This keeps the band view "lively" while still avoiding extreme jitter.
    this.bandSmoothingAlpha = options?.bandSmoothingAlpha ?? 0.65

    const bandConfigs =
      options?.bands ?? getDefaultFrequencyBands(this.audioContext.sampleRate)

    this.bandsInternal = this.computeBandStates(bandConfigs)
  }

  /**
   * Expose the underlying analyser for debug / legacy visualizers.
   * The SpectrogramRenderer relies on this for axis metadata.
   */
  getAnalyser(): AnalyserNode {
    return this.analyser
  }

  getSampleRate(): number {
    return this.audioContext.sampleRate
  }

  getMode(): AudioMode {
    return this.currentMode
  }

  getCurrentFileName(): string | null {
    return this.fileName
  }

  isFileLoaded(): boolean {
    return this.fileBuffer != null
  }

  isFilePlaying(): boolean {
    return this.fileSource != null
  }

  getBandsConfig(): FrequencyBand[] {
    return this.bandsInternal.map((b) => b.config)
  }

  /**
   * Load (decode) an audio file into memory without starting playback.
   * This allows separate play / pause control.
   */
  async setSourceFromFile(file: File): Promise<void> {
    await this.ensureRunning()
    await this.stop()

    const arrayBuffer = await file.arrayBuffer()
    const audioBuffer = await this.audioContext.decodeAudioData(arrayBuffer)

    this.fileBuffer = audioBuffer
    this.filePauseOffset = 0
    this.fileStartTime = 0
    this.fileName = file.name
    this.currentMode = 'file'
  }

  /**
   * Load an audio file from a URL (e.g., a bundled asset) without starting playback.
   */
  async setSourceFromUrl(url: string, displayName?: string): Promise<void> {
    await this.ensureRunning()
    await this.stop()

    const response = await fetch(url)
    if (!response.ok) {
      throw new Error(`Failed to fetch audio: ${response.status} ${response.statusText}`)
    }
    const arrayBuffer = await response.arrayBuffer()
    const audioBuffer = await this.audioContext.decodeAudioData(arrayBuffer)

    this.fileBuffer = audioBuffer
    this.filePauseOffset = 0
    this.fileStartTime = 0
    this.fileName = displayName ?? url.split('/').pop() ?? 'preset track'
    this.currentMode = 'file'
  }

  /**
   * Convenience: load and immediately start playing the file from the beginning.
   */
  async playFile(file: File): Promise<void> {
    await this.setSourceFromFile(file)
    this.start()
  }

  /**
   * Ensure the context is running (browsers often start it suspended).
   * Call this from user-initiated handlers only.
   */
  private async ensureRunning(): Promise<void> {
    if (this.audioContext.state === 'suspended') {
      await this.audioContext.resume()
    }
  }

  /**
   * Start or resume the current source (file or mic).
   *
   * - For file mode, this (re)starts playback from the last pause position.
   * - For mic mode, this connects the microphone stream into the analyser.
   */
  start(): void {
    if (this.currentMode === 'file') {
      this.startFilePlayback()
    } else if (this.currentMode === 'mic') {
      this.startMicCapture()
    }
  }

  /**
   * Pause playback of the current file while keeping it loaded,
   * so it can later be resumed from the same position.
   *
   * This is a file-only operation; mic capture is either on or off via start/stop.
   */
  pauseFile(): void {
    if (!this.fileSource) return

    const source = this.fileSource
    this.fileSource = null

    try {
      source.stop()
    } catch {
      // Ignore errors if already stopped.
    }
    source.disconnect()

    const elapsed = this.audioContext.currentTime - this.fileStartTime
    const duration = this.fileBuffer?.duration ?? 0
    const newOffset = this.filePauseOffset + elapsed
    this.filePauseOffset =
      duration > 0 ? Math.min(Math.max(newOffset, 0), duration) : newOffset

    // Disconnect analyser from destination while paused so we stop audio output.
    try {
      this.analyser.disconnect()
    } catch {
      // Safe to ignore if already disconnected.
    }

    // We keep currentMode as 'file' to indicate that a file source is active
    // (but currently paused).
  }

  /**
   * Selects the microphone as the current source.
   * Capture only starts flowing into the analyser once `start()` is called.
   */
  async setSourceFromMic(): Promise<void> {
    await this.ensureRunning()
    await this.stop()

    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      throw new Error('getUserMedia is not supported in this browser.')
    }

    const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
    const source = this.audioContext.createMediaStreamSource(stream)

    this.micStream = stream
    this.micSource = source
    this.currentMode = 'mic'

    // If the stream ends (e.g. device removed), reset state.
    stream.getTracks().forEach((track) => {
      track.addEventListener('ended', () => {
        if (this.currentMode === 'mic') {
          void this.stop()
        }
      })
    })
  }

  /**
   * Stops whichever source is currently active (file or mic) and
   * leaves the analyser ready for the next source.
   */
  async stop(): Promise<void> {
    // Stop file playback and reset playback position (but keep buffer loaded).
    if (this.fileSource) {
      try {
        this.fileSource.stop()
      } catch {
        // Ignore errors if already stopped.
      }
      this.fileSource.disconnect()
      this.fileSource = null
    }
    this.filePauseOffset = 0
    this.fileStartTime = 0

    // Stop microphone
    if (this.micSource) {
      this.micSource.disconnect()
      this.micSource = null
    }
    if (this.micStream) {
      this.micStream.getTracks().forEach((track) => track.stop())
      this.micStream = null
    }

    // Disconnect analyser from destination when nothing is playing.
    try {
      this.analyser.disconnect()
    } catch {
      // Safe to ignore if already disconnected.
    }

    this.currentMode = 'idle'
  }

  /**
   * Clean up all Web Audio resources.
   */
  async dispose(): Promise<void> {
    await this.stop()
    await this.audioContext.close()
  }

  /**
   * Return the latest FFT magnitudes and the current smoothed band values.
   *
   * The same frame should be shared between the spectrogram and any
   * auxiliary visualizations (e.g. band bar graph).
   */
  getFrame(): AnalyzerFrame {
    // Populate fftMagnitudes with the latest spectrum in dB.
    this.analyser.getFloatFrequencyData(
      this.fftMagnitudes as unknown as Float32Array<ArrayBuffer>,
    )

    const bands: number[] = new Array(this.bandsInternal.length)

    for (let i = 0; i < this.bandsInternal.length; i++) {
      const band = this.bandsInternal[i]

      // Aggregate magnitudes over the band's bin range.
      const { startBin, endBin } = band
      const binCount = endBin - startBin + 1

      let avgDb: number
      if (binCount <= 0) {
        avgDb = this.minDecibels
      } else {
        let sumDb = 0
        for (let k = startBin; k <= endBin; k++) {
          sumDb += this.fftMagnitudes[k]
        }
        avgDb = sumDb / binCount
      }

      // Normalize from [minDecibels, maxDecibels] -> [0, 1].
      const normalized = this.normalizeDecibels(avgDb)

      // Per-band exponential smoothing inside the analyzer so that
      // the UI receives stable values even if the raw bins are jittery.
      const alpha = this.bandSmoothingAlpha
      const prev = band.smoothedValue
      const smoothed = prev * (1 - alpha) + normalized * alpha
      band.smoothedValue = smoothed

      bands[i] = smoothed
    }

    return {
      fftMagnitudes: this.fftMagnitudes,
      bands,
    }
  }

  /**
   * File-only helper used by `start()`.
   */
  private startFilePlayback(): void {
    if (!this.fileBuffer) {
      throw new Error('No audio file loaded.')
    }
    if (this.fileSource) {
      // Already playing.
      return
    }

    const source = this.audioContext.createBufferSource()
    source.buffer = this.fileBuffer

    // Route: file source -> analyser -> destination (so we can hear it)
    source.connect(this.analyser)
    this.analyser.connect(this.audioContext.destination)

    // If we've reached (or passed) the end, restart from the beginning.
    const bufferDuration = this.fileBuffer.duration
    if (this.filePauseOffset >= bufferDuration) {
      this.filePauseOffset = 0
    }

    this.fileStartTime = this.audioContext.currentTime - this.filePauseOffset
    source.start(0, this.filePauseOffset)

    this.fileSource = source
    this.currentMode = 'file'

    source.onended = () => {
      // When playback naturally reaches the end, reset offset and mode.
      if (this.fileSource === source) {
        this.fileSource = null
        this.filePauseOffset = 0
        this.currentMode = 'idle'
      }
    }
  }

  /**
   * Mic-only helper used by `start()`.
   * Connect the MediaStream source into the analyser.
   */
  private startMicCapture(): void {
    if (!this.micSource) return

    // Route: mic source -> analyser (no connection to destination).
    // We only visualize the microphone to avoid feedback.
    this.micSource.connect(this.analyser)
    this.currentMode = 'mic'
  }

  private computeBandStates(bands: FrequencyBand[]): InternalBandState[] {
    const sampleRate = this.audioContext.sampleRate
    const fftSize = this.analyser.fftSize

    return bands.map((config) => {
      const startBin = frequencyToBinIndex(config.minHz, sampleRate, fftSize)
      const endBin = frequencyToBinIndex(config.maxHz, sampleRate, fftSize)

      return {
        config,
        startBin: Math.max(0, Math.min(startBin, this.fftMagnitudes.length - 1)),
        endBin: Math.max(0, Math.min(endBin, this.fftMagnitudes.length - 1)),
        smoothedValue: 0,
      }
    })
  }

  private normalizeDecibels(dbValue: number): number {
    const clamped = Math.min(Math.max(dbValue, this.minDecibels), this.maxDecibels)
    const range = this.maxDecibels - this.minDecibels || 1
    return (clamped - this.minDecibels) / range
  }
}

/**
 * Default 6-band musical layout, matching the ranges described in the spec.
 * The labels are short and intended for compact debug UI.
 */
function getDefaultFrequencyBands(sampleRate: number): FrequencyBand[] {
  // Clamp the highest band to Nyquist to avoid weird ranges on very low SRs.
  const nyquist = sampleRate / 2

  const clampMax = (hz: number) => Math.min(hz, nyquist)

  return [
    { id: 'sub', label: 'Sub', minHz: 20, maxHz: clampMax(60) },
    { id: 'bass', label: 'Bass', minHz: 60, maxHz: clampMax(250) },
    { id: 'low-mid', label: 'Low-mid', minHz: 250, maxHz: clampMax(500) },
    { id: 'mid', label: 'Mid', minHz: 500, maxHz: clampMax(2000) },
    {
      id: 'presence',
      label: 'Presence',
      minHz: 2000,
      maxHz: clampMax(6000),
    },
    {
      id: 'brilliance',
      label: 'Brilliance',
      minHz: 6000,
      maxHz: clampMax(16000),
    },
  ]
}


