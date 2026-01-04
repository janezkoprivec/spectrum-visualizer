import type { AudioMode } from './audio'
import { frequencyToBinIndex } from './audio'

export interface FrequencyBand {
  id: string
  label: string
  minHz: number
  maxHz: number
}

export interface AnalyzerFrame {
  fftMagnitudes: Float32Array
  bands: number[]
}

export interface AudioAnalyzerOptions {
  fftSize?: number
  smoothingTimeConstant?: number
  minDecibels?: number
  maxDecibels?: number
  bands?: FrequencyBand[]
  bandSmoothingAlpha?: number
}

interface InternalBandState {
  config: FrequencyBand
  startBin: number
  endBin: number
  smoothedValue: number
}

export class AudioAnalyzer {
  private readonly audioContext: AudioContext
  private readonly analyser: AnalyserNode

  private readonly minDecibels: number
  private readonly maxDecibels: number

  private readonly bandSmoothingAlpha: number
  private readonly bandsInternal: InternalBandState[]

  private readonly fftMagnitudes: Float32Array

  private currentMode: AudioMode = 'idle'

  private fileSource: AudioBufferSourceNode | null = null
  private fileBuffer: AudioBuffer | null = null
  private filePauseOffset = 0
  private fileStartTime = 0
  private fileName: string | null = null

  private micStream: MediaStream | null = null
  private micSource: MediaStreamAudioSourceNode | null = null

  constructor(options?: AudioAnalyzerOptions) {
    this.audioContext = new AudioContext()
    this.analyser = this.audioContext.createAnalyser()

    const fftSize = options?.fftSize ?? 2048
    this.analyser.fftSize = fftSize

    this.analyser.smoothingTimeConstant = options?.smoothingTimeConstant ?? 0.4

    this.minDecibels = options?.minDecibels ?? -100
    this.maxDecibels = options?.maxDecibels ?? -30

    this.analyser.minDecibels = this.minDecibels
    this.analyser.maxDecibels = this.maxDecibels

    this.fftMagnitudes = new Float32Array(this.analyser.frequencyBinCount)

    this.bandSmoothingAlpha = options?.bandSmoothingAlpha ?? 0.65

    const bandConfigs =
      options?.bands ?? getDefaultFrequencyBands(this.audioContext.sampleRate)

    this.bandsInternal = this.computeBandStates(bandConfigs)
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

  getBandsConfig(): FrequencyBand[] {
    return this.bandsInternal.map((b) => b.config)
  }

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

  async playFile(file: File): Promise<void> {
    await this.setSourceFromFile(file)
    this.start()
  }

  private async ensureRunning(): Promise<void> {
    if (this.audioContext.state === 'suspended') {
      await this.audioContext.resume()
    }
  }

  start(): void {
    if (this.currentMode === 'file') {
      this.startFilePlayback()
    } else if (this.currentMode === 'mic') {
      this.startMicCapture()
    }
  }

  pauseFile(): void {
    if (!this.fileSource) return

    const source = this.fileSource
    this.fileSource = null

    try {
      source.stop()
    } catch (error) {
      void error
    }
    source.disconnect()

    const elapsed = this.audioContext.currentTime - this.fileStartTime
    const duration = this.fileBuffer?.duration ?? 0
    const newOffset = this.filePauseOffset + elapsed
    this.filePauseOffset =
      duration > 0 ? Math.min(Math.max(newOffset, 0), duration) : newOffset

    try {
      this.analyser.disconnect()
    } catch (error) {
      void error
    }
  }

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

    stream.getTracks().forEach((track) => {
      track.addEventListener('ended', () => {
        if (this.currentMode === 'mic') {
          void this.stop()
        }
      })
    })
  }

  async stop(): Promise<void> {
    if (this.fileSource) {
      try {
        this.fileSource.stop()
      } catch (error) {
        void error
      }
      this.fileSource.disconnect()
      this.fileSource = null
    }
    this.filePauseOffset = 0
    this.fileStartTime = 0

    if (this.micSource) {
      this.micSource.disconnect()
      this.micSource = null
    }
    if (this.micStream) {
      this.micStream.getTracks().forEach((track) => track.stop())
      this.micStream = null
    }

    try {
      this.analyser.disconnect()
    } catch (error) {
      void error
    }

    this.currentMode = 'idle'
  }

  async dispose(): Promise<void> {
    await this.stop()
    await this.audioContext.close()
  }

  getFrame(): AnalyzerFrame {
    this.analyser.getFloatFrequencyData(
      this.fftMagnitudes as unknown as Float32Array<ArrayBuffer>,
    )

    const bands: number[] = new Array(this.bandsInternal.length)

    for (let i = 0; i < this.bandsInternal.length; i++) {
      const band = this.bandsInternal[i]

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

      const normalized = this.normalizeDecibels(avgDb)

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

  private startFilePlayback(): void {
    if (!this.fileBuffer) {
      throw new Error('No audio file loaded.')
    }
    if (this.fileSource) {
      return
    }

    const source = this.audioContext.createBufferSource()
    source.buffer = this.fileBuffer

    source.connect(this.analyser)
    this.analyser.connect(this.audioContext.destination)

    const bufferDuration = this.fileBuffer.duration
    if (this.filePauseOffset >= bufferDuration) {
      this.filePauseOffset = 0
    }

    this.fileStartTime = this.audioContext.currentTime - this.filePauseOffset
    source.start(0, this.filePauseOffset)

    this.fileSource = source
    this.currentMode = 'file'

    source.onended = () => {
      if (this.fileSource === source) {
        this.fileSource = null
        this.filePauseOffset = 0
        this.currentMode = 'idle'
      }
    }
  }

  private startMicCapture(): void {
    if (!this.micSource) return

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

function getDefaultFrequencyBands(sampleRate: number): FrequencyBand[] {
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


