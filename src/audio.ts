export type AudioMode = 'idle' | 'file' | 'mic'

export interface AudioManagerOptions {
  /**
   * FFT size used by the analyser.
   * 2048 is a good compromise between frequency resolution and CPU cost:
   * at 44.1 kHz it gives about 21 Hz per bin.
   */
  fftSize?: number
}

/**
 * Helper: map FFT bin index to frequency in Hz.
 * binIndex is in [0, fftSize/2), mapping linearly from 0 Hz to Nyquist.
 */
export function binIndexToFrequency(
  binIndex: number,
  sampleRate: number,
  fftSize: number,
): number {
  const nyquist = sampleRate / 2
  const maxBin = fftSize / 2
  const clamped = Math.min(Math.max(binIndex, 0), maxBin)
  return (clamped / maxBin) * nyquist
}

/**
 * Helper: map a target frequency in Hz to the closest FFT bin index.
 */
export function frequencyToBinIndex(
  frequency: number,
  sampleRate: number,
  fftSize: number,
): number {
  const nyquist = sampleRate / 2
  if (frequency <= 0) return 0
  if (frequency >= nyquist) return fftSize / 2 - 1
  const ratio = frequency / nyquist
  return Math.round(ratio * (fftSize / 2 - 1))
}

/**
 * AudioManager encapsulates:
 * - A single AudioContext
 * - A shared AnalyserNode used for FFT
 * - Switching between file playback and microphone input
 */
export class AudioManager {
  private readonly audioContext: AudioContext
  private readonly analyser: AnalyserNode
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

  constructor(options?: AudioManagerOptions) {
    this.audioContext = new AudioContext()
    this.analyser = this.audioContext.createAnalyser()

    const fftSize = options?.fftSize ?? 2048
    this.analyser.fftSize = fftSize

    // Smoothing reduces frame-to-frame "flicker" in the spectrogram.
    this.analyser.smoothingTimeConstant = 0.8

    // Decibel range for getFloatFrequencyData.
    // We keep this fairly wide; the renderer can further clamp/scale.
    this.analyser.minDecibels = -100
    this.analyser.maxDecibels = -30
  }

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
   * Load (decode) an audio file into memory without starting playback.
   * This allows separate play / pause control.
   */
  async loadFile(file: File): Promise<void> {
    await this.ensureRunning()
    await this.stopCurrentSource()

    const arrayBuffer = await file.arrayBuffer()
    const audioBuffer = await this.audioContext.decodeAudioData(arrayBuffer)

    this.fileBuffer = audioBuffer
    this.filePauseOffset = 0
    this.fileStartTime = 0
    this.fileName = file.name
    this.currentMode = 'file'
  }

  /**
   * Convenience: load and immediately start playing the file from the beginning.
   */
  async playFile(file: File): Promise<void> {
    await this.loadFile(file)
    this.playLoadedFile()
  }

  /**
   * Start or resume playback of the currently loaded file.
   */
  playLoadedFile(): void {
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
   * Pause playback of the current file while keeping it loaded,
   * so it can later be resumed from the same position.
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

    // Disconnect analyser from destination while paused.
    try {
      this.analyser.disconnect()
    } catch {
      // Safe to ignore if already disconnected.
    }

    // We keep currentMode as 'file' to indicate that a file source is active
    // (but currently paused).
  }

  /**
   * Start microphone capture and route it into the analyser.
   * For educational use we do not monitor the mic to the speakers
   * to avoid feedback; we only visualize it.
   */
  async startMic(): Promise<void> {
    await this.ensureRunning()
    await this.stopCurrentSource()

    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      throw new Error('getUserMedia is not supported in this browser.')
    }

    const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
    const source = this.audioContext.createMediaStreamSource(stream)

    // Route: mic source -> analyser (no connection to destination)
    source.connect(this.analyser)

    this.micStream = stream
    this.micSource = source
    this.currentMode = 'mic'

    // If the stream ends (e.g. device removed), reset state.
    stream.getTracks().forEach((track) => {
      track.addEventListener('ended', () => {
        if (this.currentMode === 'mic') {
          void this.stopCurrentSource()
        }
      })
    })
  }

  /**
   * Stop whichever source is currently active (file or mic) and
   * leave the analyser ready for the next source.
   */
  async stopCurrentSource(): Promise<void> {
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
    await this.stopCurrentSource()
    await this.audioContext.close()
  }
}
