import { frequencyToBinIndex } from './audio'
import type { AnalyzerFrame } from './AudioAnalyzer'
import type { AudioAnalyzer } from './AudioAnalyzer'

export interface SpectrogramOptions {
  minDecibels?: number
  maxDecibels?: number
  frequencyTicks?: number[]
}

export class SpectrogramRenderer {
  private readonly canvas: HTMLCanvasElement
  private readonly ctx: CanvasRenderingContext2D
  private readonly audioAnalyzer: AudioAnalyzer
  private readonly analyser: AnalyserNode

  private readonly onFrame?: (frame: AnalyzerFrame) => void

  private readonly minDecibels: number
  private readonly maxDecibels: number
  private readonly frequencyTicks: number[]

  private readonly axisWidth = 56

  private animationFrameId: number | null = null
  private isPaused = false

  constructor(
    canvas: HTMLCanvasElement,
    audioAnalyzer: AudioAnalyzer,
    options?: SpectrogramOptions,
    onFrame?: (frame: AnalyzerFrame) => void,
  ) {
    const ctx = canvas.getContext('2d')
    if (!ctx) {
      throw new Error('2D canvas context is not available.')
    }

    this.canvas = canvas
    this.ctx = ctx
    this.audioAnalyzer = audioAnalyzer
    this.analyser = audioAnalyzer.getAnalyser()
    this.onFrame = onFrame

    this.minDecibels =
      options?.minDecibels ?? this.analyser.minDecibels ?? -100
    this.maxDecibels =
      options?.maxDecibels ?? this.analyser.maxDecibels ?? -30

    this.frequencyTicks =
      options?.frequencyTicks ?? [100, 500, 1000, 2000, 5000, 10000]

    this.clear()
  }

  setPaused(paused: boolean): void {
    this.isPaused = paused
  }

  start(): void {
    if (this.animationFrameId != null) return
    const loop = () => {
      this.drawFrame()
      this.animationFrameId = window.requestAnimationFrame(loop)
    }
    this.animationFrameId = window.requestAnimationFrame(loop)
  }

  stop(): void {
    if (this.animationFrameId != null) {
      window.cancelAnimationFrame(this.animationFrameId)
      this.animationFrameId = null
    }
  }

  clear(): void {
    const { width, height } = this.canvas
    this.ctx.fillStyle = 'black'
    this.ctx.fillRect(0, 0, width, height)
  }

  private drawFrame(): void {
    const { width, height } = this.canvas
    const axisWidth = this.axisWidth
    const specWidth = width - axisWidth

    if (specWidth <= 1 || height <= 0) return

    if (this.isPaused) {
      this.drawFrequencyAxis()
      return
    }

    const frame = this.audioAnalyzer.getFrame()
    const freqData = frame.fftMagnitudes

    this.onFrame?.(frame)

    this.ctx.drawImage(
      this.canvas,
      axisWidth + 1,
      0,
      specWidth - 1,
      height,
      axisWidth,
      0,
      specWidth - 1,
      height,
    )

    const x = width - 1
    for (let y = 0; y < height; y++) {
      const norm = 1 - y / (height - 1)
      const binIndex = Math.round(norm * (freqData.length - 1)) || 0

      const magDb = freqData[binIndex]
      const value = this.normalizeDecibels(magDb)
      const [r, g, b] = this.colourMap(value)

      this.ctx.fillStyle = `rgb(${r}, ${g}, ${b})`
      this.ctx.fillRect(x, y, 1, 1)
    }

    this.drawFrequencyAxis()
  }

  private normalizeDecibels(dbValue: number): number {
    const clamped = Math.min(Math.max(dbValue, this.minDecibels), this.maxDecibels)
    const range = this.maxDecibels - this.minDecibels || 1
    return (clamped - this.minDecibels) / range
  }

  private colourMap(value: number): [number, number, number] {
    const v = Math.min(Math.max(value, 0), 1)

    if (v < 0.25) {
      const t = v / 0.25
      return [0, 0, Math.round(80 + t * 60)]
    }
    if (v < 0.5) {
      const t = (v - 0.25) / 0.25
      return [0, Math.round(t * 255), 140 + Math.round(t * 115)]
    }
    if (v < 0.75) {
      const t = (v - 0.5) / 0.25
      return [Math.round(t * 255), 255, Math.round(255 - t * 255)]
    }
    const t = (v - 0.75) / 0.25
    const base = 255
    const extra = Math.round(t * 30)
    return [base, base, base - 40 + extra]
  }

  private binIndexToY(binIndex: number, height: number): number {
    const maxBin = this.analyser.frequencyBinCount - 1 || 1
    const clamped = Math.min(Math.max(binIndex, 0), maxBin)
    const norm = clamped / maxBin
    return height - norm * height
  }

  private drawFrequencyAxis(): void {
    const { width, height } = this.canvas
    const axisWidth = this.axisWidth

    const sampleRate = this.analyser.context.sampleRate
    const fftSize = this.analyser.fftSize

    this.ctx.save()
    this.ctx.fillStyle = 'rgba(0, 0, 0, 0.9)'
    this.ctx.fillRect(0, 0, axisWidth, height)

    this.ctx.strokeStyle = 'rgba(255, 255, 255, 0.15)'
    this.ctx.lineWidth = 1

    this.ctx.font = '10px system-ui, -apple-system, BlinkMacSystemFont, sans-serif'
    this.ctx.fillStyle = 'rgba(220, 220, 220, 0.9)'
    this.ctx.textAlign = 'left'
    this.ctx.textBaseline = 'middle'

    for (const freq of this.frequencyTicks) {
      const binIndex = frequencyToBinIndex(freq, sampleRate, fftSize)
      const y = this.binIndexToY(binIndex, height)

      this.ctx.beginPath()
      this.ctx.moveTo(axisWidth, y)
      this.ctx.lineTo(width, y)
      this.ctx.stroke()

      const label = this.formatFrequency(freq)
      this.ctx.fillText(label, 4, y)
    }

    this.ctx.restore()
  }

  private formatFrequency(freq: number): string {
    if (freq >= 1000) {
      const value = freq / 1000
      return `${value.toFixed(value >= 10 ? 0 : 1)} kHz`
    }
    return `${Math.round(freq)} Hz`
  }
}


