import { frequencyToBinIndex } from './audio'

export interface SpectrogramOptions {
  /**
   * Optional override for the decibel range used when normalizing colours.
   * If omitted, the analyser's min/maxDecibels are used.
   */
  minDecibels?: number
  maxDecibels?: number

  /**
   * Frequencies (in Hz) to label along the vertical axis.
   */
  frequencyTicks?: number[]
}

/**
 * SpectrogramRenderer is responsible for:
 * - Pulling FFT magnitude data from an AnalyserNode each animation frame
 * - Drawing a scrolling spectrogram into a <canvas>
 * - Drawing a simple linear frequency axis on the left
 *
 * The mapping from FFT bins to vertical pixels is linear:
 * low frequencies at the bottom, high frequencies at the top.
 * This keeps the code simple and makes it easy to later plug in a
 * logarithmic mapping if desired.
 */
export class SpectrogramRenderer {
  private readonly canvas: HTMLCanvasElement
  private readonly ctx: CanvasRenderingContext2D
  private readonly analyser: AnalyserNode

  private readonly freqData: Float32Array

  private readonly minDecibels: number
  private readonly maxDecibels: number
  private readonly frequencyTicks: number[]

  // Left margin reserved for frequency labels (in CSS pixels).
  private readonly axisWidth = 56

  private animationFrameId: number | null = null

  constructor(
    canvas: HTMLCanvasElement,
    analyser: AnalyserNode,
    options?: SpectrogramOptions,
  ) {
    const ctx = canvas.getContext('2d')
    if (!ctx) {
      throw new Error('2D canvas context is not available.')
    }

    this.canvas = canvas
    this.ctx = ctx
    this.analyser = analyser

    this.freqData = new Float32Array(this.analyser.frequencyBinCount)

    this.minDecibels =
      options?.minDecibels ?? this.analyser.minDecibels ?? -100
    this.maxDecibels =
      options?.maxDecibels ?? this.analyser.maxDecibels ?? -30

    this.frequencyTicks =
      options?.frequencyTicks ?? [100, 500, 1000, 2000, 5000, 10000]

    // Initial clear
    this.clear()
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

    // Fetch latest FFT magnitudes (in decibels).
    this.analyser.getFloatFrequencyData(this.freqData)

    // Scroll existing spectrogram 1px to the left inside the spectrogram area.
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

    // Draw new column at the rightmost x.
    const x = width - 1
    for (let y = 0; y < height; y++) {
      // Linear mapping: y=0 is top (highest freq), y=height-1 is bottom (0 Hz).
      const norm = 1 - y / (height - 1)
      const binIndex =
        Math.round(norm * (this.freqData.length - 1)) || 0

      const magDb = this.freqData[binIndex]
      const value = this.normalizeDecibels(magDb) // [0, 1]
      const [r, g, b] = this.colourMap(value)

      this.ctx.fillStyle = `rgb(${r}, ${g}, ${b})`
      this.ctx.fillRect(x, y, 1, 1)
    }

    // Overlay frequency grid/labels after drawing the spectrogram pixels.
    this.drawFrequencyAxis()
  }

  /**
   * Normalize decibel value into [0, 1] for colour mapping.
   */
  private normalizeDecibels(dbValue: number): number {
    const clamped = Math.min(Math.max(dbValue, this.minDecibels), this.maxDecibels)
    const range = this.maxDecibels - this.minDecibels || 1
    return (clamped - this.minDecibels) / range
  }

  /**
   * Simple "warm" colour map:
   * 0 -> black, mid -> dark blue -> cyan, high -> yellow/white.
   * This is intentionally straightforward so it can be easily replaced
   * with a more advanced palette later.
   */
  // eslint-disable-next-line class-methods-use-this
  private colourMap(value: number): [number, number, number] {
    const v = Math.min(Math.max(value, 0), 1)

    // Piecewise gradient
    if (v < 0.25) {
      // Black -> dark blue
      const t = v / 0.25
      return [0, 0, Math.round(80 + t * 60)]
    }
    if (v < 0.5) {
      // Dark blue -> cyan
      const t = (v - 0.25) / 0.25
      return [0, Math.round(t * 255), 140 + Math.round(t * 115)]
    }
    if (v < 0.75) {
      // Cyan -> yellow
      const t = (v - 0.5) / 0.25
      return [Math.round(t * 255), 255, Math.round(255 - t * 255)]
    }
    // Yellow -> white
    const t = (v - 0.75) / 0.25
    const base = 255
    const extra = Math.round(t * 30)
    return [base, base, base - 40 + extra]
  }

  /**
   * Map FFT bin index to canvas y coordinate.
   * Linear mapping: low frequencies at the bottom, high at the top.
   */
  private binIndexToY(binIndex: number, height: number): number {
    const maxBin = this.analyser.frequencyBinCount - 1 || 1
    const clamped = Math.min(Math.max(binIndex, 0), maxBin)
    const norm = clamped / maxBin
    return height - norm * height
  }

  /**
   * Draw frequency labels and grid lines on top of the spectrogram.
   * This is where a logarithmic mapping would be implemented later if desired.
   */
  private drawFrequencyAxis(): void {
    const { width, height } = this.canvas
    const axisWidth = this.axisWidth

    const sampleRate = this.analyser.context.sampleRate
    const fftSize = this.analyser.fftSize

    // Axis background
    this.ctx.save()
    this.ctx.fillStyle = 'rgba(0, 0, 0, 0.9)'
    this.ctx.fillRect(0, 0, axisWidth, height)

    // Grid line style
    this.ctx.strokeStyle = 'rgba(255, 255, 255, 0.15)'
    this.ctx.lineWidth = 1

    this.ctx.font = '10px system-ui, -apple-system, BlinkMacSystemFont, sans-serif'
    this.ctx.fillStyle = 'rgba(220, 220, 220, 0.9)'
    this.ctx.textAlign = 'left'
    this.ctx.textBaseline = 'middle'

    for (const freq of this.frequencyTicks) {
      const binIndex = frequencyToBinIndex(freq, sampleRate, fftSize)
      const y = this.binIndexToY(binIndex, height)

      // Horizontal grid line across the spectrogram.
      this.ctx.beginPath()
      this.ctx.moveTo(axisWidth, y)
      this.ctx.lineTo(width, y)
      this.ctx.stroke()

      // Label inside the axis area.
      const label = this.formatFrequency(freq)
      this.ctx.fillText(label, 4, y)
    }

    this.ctx.restore()
  }

  // eslint-disable-next-line class-methods-use-this
  private formatFrequency(freq: number): string {
    if (freq >= 1000) {
      const value = freq / 1000
      return `${value.toFixed(value >= 10 ? 0 : 1)} kHz`
    }
    return `${Math.round(freq)} Hz`
  }
}


