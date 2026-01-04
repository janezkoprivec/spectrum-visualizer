import { useEffect, useRef, useState } from 'react'
import '../App.css'
import type { AudioMode } from '../audio'
import { AudioAnalyzer } from '../AudioAnalyzer'
import type { PresetTrack } from '../tracks'
import { getPresetTracks } from '../tracks'
import type { BandMeta, MoodState, Palette } from '../mood'
import { paletteFromMood, updateMoodFromBands } from '../mood'

type VisualMode = 'bars' | 'rings' | 'particles' | 'hybrid'

interface Particle {
  x: number
  y: number
  vx: number
  vy: number
  life: number
  hue: number
  band: number
}

const VISUALS: Record<VisualMode, string> = {
  bars: 'Neon bars',
  rings: 'Pulse rings',
  particles: 'Glow particles',
  hybrid: 'Pulse + sparks',
}

function withAlpha(color: string, alpha: number): string {
  const clamped = Math.max(0, Math.min(1, alpha))
  return `color-mix(in srgb, ${color} ${clamped * 100}%, transparent)`
}

function createParticles(
  count: number,
  width: number,
  height: number,
  bandCount = 6,
): Particle[] {
  const particles: Particle[] = []
  for (let i = 0; i < count; i++) {
    particles.push({
      x: Math.random() * width,
      y: Math.random() * height,
      vx: (Math.random() - 0.5) * 0.8,
      vy: (Math.random() - 0.5) * 0.8,
      life: Math.random() * 0.8 + 0.2,
      hue: 190 + Math.random() * 100,
      band: i % Math.max(1, bandCount),
    })
  }
  return particles
}

function respawnParticle(p: Particle, width: number, height: number, bandCount = 6): void {
  p.x = Math.random() * width
  p.y = Math.random() * height
  p.vx = (Math.random() - 0.5) * 0.9
  p.vy = (Math.random() - 0.5) * 0.9
  p.life = Math.random() * 0.8 + 0.2
  p.hue = 180 + Math.random() * 140
  p.band = Math.floor(Math.random() * Math.max(1, bandCount))
}

function respawnParticleRadial(p: Particle, cx: number, cy: number, bandCount = 6): void {
  const angle = Math.random() * Math.PI * 2
  const speed = 0.35 + Math.random() * 0.6
  p.x = cx
  p.y = cy
  p.vx = Math.cos(angle) * speed
  p.vy = Math.sin(angle) * speed
  p.life = 0.8 + Math.random() * 0.8
  p.hue = 190 + Math.random() * 120
  p.band = Math.floor(Math.random() * Math.max(1, bandCount))
}

function drawBars(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  bands: number[],
  palette: Palette,
): void {
  const gradient = ctx.createLinearGradient(0, height, 0, 0)
  gradient.addColorStop(0, palette.background)
  gradient.addColorStop(1, palette.base)
  ctx.fillStyle = gradient
  ctx.fillRect(0, 0, width, height)

  const barCount = Math.max(bands.length, 1)
  const barWidth = width / barCount

  bands.forEach((value, index) => {
    const clamped = Math.max(0, Math.min(value, 1))
    const magnitude = Math.pow(clamped, 0.8)
    const barHeight = Math.max(6, magnitude * (height * 0.85))
    const x = index * barWidth
    const y = height - barHeight

    const barGradient = ctx.createLinearGradient(0, y, 0, height)
    barGradient.addColorStop(0, palette.accent)
    barGradient.addColorStop(1, palette.base)
    ctx.fillStyle = barGradient
    ctx.fillRect(x + 6, y, barWidth - 12, barHeight)

    // Glow on top of each bar to emphasize peaks.
    ctx.fillStyle = palette.highlight
    ctx.fillRect(x + 6, y - 4, barWidth - 12, 4)
  })
}

function drawRings(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  bands: number[],
  palette: Palette,
): void {
  ctx.fillStyle = palette.background
  ctx.fillRect(0, 0, width, height)

  const cx = width / 2
  const cy = height / 2
  const baseRadius = Math.min(width, height) / 8

  bands.forEach((value, index) => {
    const level = Math.max(0, Math.min(value, 1))
    const radius = baseRadius + index * (baseRadius * 0.6) + level * 90

    ctx.beginPath()
    ctx.arc(cx, cy, radius, 0, Math.PI * 2)
    ctx.strokeStyle = palette.ring
    ctx.lineWidth = 4 + level * 14
    ctx.shadowBlur = 20 + level * 40
    ctx.shadowColor = palette.highlight
    ctx.stroke()
  })

  ctx.shadowBlur = 0
  const pulse = bands.reduce((a, b) => a + b, 0) / Math.max(bands.length, 1)
  const pulseRadius = baseRadius * (1.2 + pulse * 1.8)

  ctx.beginPath()
  ctx.arc(cx, cy, pulseRadius, 0, Math.PI * 2)
  const radial = ctx.createRadialGradient(cx, cy, pulseRadius * 0.25, cx, cy, pulseRadius)
  radial.addColorStop(0, withAlpha(palette.highlight, 0.45))
  radial.addColorStop(1, 'rgba(0, 0, 0, 0)')
  ctx.fillStyle = radial
  ctx.fill()
}

function drawParticles(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  bands: number[],
  particles: Particle[],
  palette: Palette,
): void {
  ctx.fillStyle = palette.background
  ctx.fillRect(0, 0, width, height)

  const avgEnergy = bands.reduce((a, b) => a + b, 0) / Math.max(bands.length, 1)
  const bass = bands[0] ?? avgEnergy
  const boost = 0.7 + avgEnergy * 3.2

  particles.forEach((p) => {
    p.x += p.vx * boost * 6
    p.y += p.vy * boost * 6
    p.life -= 0.004 + avgEnergy * 0.01

    if (p.life <= 0 || p.x < -20 || p.x > width + 20 || p.y < -20 || p.y > height + 20) {
      respawnParticle(p, width, height)
    }
  })

  ctx.globalCompositeOperation = 'lighter'
  particles.forEach((p) => {
    const brightness = Math.max(0.25, Math.min(1, p.life + avgEnergy * 0.8))
    const size = 2 + bass * 10 * p.life
    const gradient = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, size * 3)
    gradient.addColorStop(0, withAlpha(palette.particle, 0.9 * brightness))
    gradient.addColorStop(1, 'rgba(0, 0, 0, 0)')
    ctx.fillStyle = gradient
    ctx.beginPath()
    ctx.arc(p.x, p.y, size * 3, 0, Math.PI * 2)
    ctx.fill()
  })
  ctx.globalCompositeOperation = 'source-over'
}

function drawHybrid(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  bands: number[],
  particles: Particle[],
  palette: Palette,
): void {
  ctx.fillStyle = palette.background
  ctx.fillRect(0, 0, width, height)

  const cx = width / 2
  const cy = height / 2
  const sub = bands[0] ?? 0
  const bass = bands[1] ?? sub

  const ringBase = Math.min(width, height) / 10
  const ringLevels: Array<{ level: number; hue: number }> = [
    { level: sub, hue: 210 },
    { level: bass, hue: 260 },
  ]

  let outerRing = 0
  ringLevels.forEach((entry, idx) => {
    const radius = ringBase + idx * ringBase * 0.8 + entry.level * 90
    outerRing = Math.max(outerRing, radius + (6 + entry.level * 18))
    ctx.beginPath()
    ctx.arc(cx, cy, radius, 0, Math.PI * 2)
    ctx.strokeStyle = palette.ring
    ctx.lineWidth = 6 + entry.level * 18
    ctx.shadowBlur = 25 + entry.level * 60
    ctx.shadowColor = palette.highlight
    ctx.stroke()
  })
  ctx.shadowBlur = 0

  const avgEnergy = bands.reduce((a, b) => a + b, 0) / Math.max(bands.length, 1)
  const bandCount = Math.max(bands.length, 1)
  const exclusionRadius = outerRing + 10
  const maxRadius = Math.max(width, height) * 0.65

  // Update particles with band-linked speed to better follow the music.
  particles.forEach((p) => {
    const bandEnergy = bands[p.band] ?? avgEnergy
    const speed = 0.35 + bandEnergy * 2.2
    p.x += p.vx * speed * 6
    p.y += p.vy * speed * 6
    p.life -= 0.005 + bandEnergy * 0.01

    const dx = p.x - cx
    const dy = p.y - cy
    const dist = Math.sqrt(dx * dx + dy * dy)

    if (dist < exclusionRadius) {
      const push = (exclusionRadius - dist) * 0.4
      const normX = dx === 0 && dy === 0 ? 1 : dx / Math.max(dist, 0.001)
      const normY = dx === 0 && dy === 0 ? 0 : dy / Math.max(dist, 0.001)
      p.x += normX * push
      p.y += normY * push
    }

    if (
      p.life <= 0 ||
      p.x < -80 ||
      p.x > width + 80 ||
      p.y < -80 ||
      p.y > height + 80 ||
      dist > maxRadius
    ) {
      respawnParticleRadial(p, cx, cy, bandCount)
    }
  })

  ctx.globalCompositeOperation = 'lighter'
  particles.forEach((p) => {
    const bandEnergy = bands[p.band] ?? avgEnergy
    const size = 2 + bandEnergy * 14 * p.life
    const alpha = 0.3 + Math.min(0.7, bandEnergy * 1.2)
    const dx = p.x - cx
    const dy = p.y - cy
    const dist = Math.sqrt(dx * dx + dy * dy)

    // Skip rendering inside the ring zone.
    if (dist < exclusionRadius) {
      return
    }

    // Tail line to show velocity.
    ctx.strokeStyle = withAlpha(palette.particle, alpha)
    ctx.lineWidth = Math.max(1, size * 0.15)
    ctx.beginPath()
    ctx.moveTo(p.x, p.y)
    ctx.lineTo(p.x - p.vx * 12, p.y - p.vy * 12)
    ctx.stroke()

    const gradient = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, size * 3)
    gradient.addColorStop(0, withAlpha(palette.particle, alpha))
    gradient.addColorStop(1, 'rgba(0, 0, 0, 0)')
    ctx.fillStyle = gradient
    ctx.beginPath()
    ctx.arc(p.x, p.y, size * 3, 0, Math.PI * 2)
    ctx.fill()
  })
  ctx.globalCompositeOperation = 'source-over'
}

function renderFrame(
  ctx: CanvasRenderingContext2D,
  canvas: HTMLCanvasElement,
  mode: VisualMode,
  bands: number[],
  particles: Particle[],
  palette: Palette,
): void {
  const { width, height } = canvas
  switch (mode) {
    case 'bars':
      drawBars(ctx, width, height, bands, palette)
      break
    case 'rings':
      drawRings(ctx, width, height, bands, palette)
      break
    case 'particles':
      drawParticles(ctx, width, height, bands, particles, palette)
      break
    case 'hybrid':
      drawHybrid(ctx, width, height, bands, particles, palette)
      break
  }
}

function VisualModeButtons({
  active,
  onChange,
}: {
  active: VisualMode
  onChange: (mode: VisualMode) => void
}) {
  return (
    <div className="visual-mode-toggle">
      {Object.entries(VISUALS).map(([mode, label]) => {
        const visualKey = mode as VisualMode
        const isActive = active === visualKey
        return (
          <button
            key={mode}
            type="button"
            className={`visual-mode-button ${isActive ? 'active' : ''}`}
            onClick={() => onChange(visualKey)}
          >
            {label}
          </button>
        )
      })}
    </div>
  )
}

function VjVisuals() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const audioAnalyzerRef = useRef<AudioAnalyzer | null>(null)
  const animationRef = useRef<number | null>(null)
  const particlesRef = useRef<Particle[]>([])
  const visualModeRef = useRef<VisualMode>('bars')
  const bandMetaRef = useRef<BandMeta[]>([])
  const moodRef = useRef<MoodState | undefined>(undefined)

  const presetTracks = getPresetTracks()
  const [audioMode, setAudioMode] = useState<AudioMode>('idle')
  const [status, setStatus] = useState('Initializing audio context...')
  const [hasFile, setHasFile] = useState(false)
  const [isFilePlaying, setIsFilePlaying] = useState(false)
  const [visualMode, setVisualMode] = useState<VisualMode>('bars')

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return

    const ctx = canvas.getContext('2d')
    if (!ctx) {
      queueMicrotask(() => setStatus('Canvas context unavailable.'))
      return
    }

    const analyzer = new AudioAnalyzer({
      fftSize: 2048,
      bandSmoothingAlpha: 0.6,
    })
    audioAnalyzerRef.current = analyzer

    const bandConfig = analyzer.getBandsConfig()
    bandMetaRef.current = bandConfig.map((band) => ({
      centerHz: (band.minHz + band.maxHz) / 2,
    }))
    const bandCount = bandConfig.length
    particlesRef.current = createParticles(220, canvas.width, canvas.height, bandCount)
    queueMicrotask(() =>
      setStatus('Ready. Load a track or open the mic, then pick a visual.'),
    )

    const loop = () => {
      const frame = analyzer.getFrame()
      const mood = updateMoodFromBands(moodRef.current, frame.bands, bandMetaRef.current)
      moodRef.current = mood
      const palette = paletteFromMood(mood)
      renderFrame(
        ctx,
        canvas,
        visualModeRef.current,
        frame.bands,
        particlesRef.current,
        palette,
      )
      animationRef.current = window.requestAnimationFrame(loop)
    }
    animationRef.current = window.requestAnimationFrame(loop)

    return () => {
      if (animationRef.current != null) {
        window.cancelAnimationFrame(animationRef.current)
      }
      void analyzer.dispose()
      audioAnalyzerRef.current = null
    }
  }, [])

  useEffect(() => {
    visualModeRef.current = visualMode
  }, [visualMode])

  const handleFileChange: React.ChangeEventHandler<HTMLInputElement> = async (
    event,
  ) => {
    const file = event.target.files?.[0]
    if (!file) return

    const analyzer = audioAnalyzerRef.current
    if (!analyzer) {
      setStatus('Audio analyzer not ready.')
      return
    }

    try {
      setStatus('Loading and decoding file...')
      await analyzer.setSourceFromFile(file)
      setAudioMode('file')
      setHasFile(true)
      setIsFilePlaying(false)
      setStatus(`Loaded: ${file.name}. Hit Play to start the VJ view.`)
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Unknown error while loading file.'
      setStatus(`File error: ${message}`)
      console.error(error)
    }
  }

  const handleFilePlay = () => {
    const analyzer = audioAnalyzerRef.current
    if (!analyzer) {
      setStatus('Audio analyzer not ready.')
      return
    }
    try {
      analyzer.start()
      setAudioMode('file')
      setIsFilePlaying(true)
      const name = analyzer.getCurrentFileName() ?? 'audio file'
      setStatus(`Playing ${name}. Visuals are live.`)
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Unable to start playback.'
      setStatus(`Play error: ${message}`)
      console.error(error)
    }
  }

  const handleFilePause = () => {
    const analyzer = audioAnalyzerRef.current
    if (!analyzer) {
      setStatus('Audio analyzer not ready.')
      return
    }
    analyzer.pauseFile()
    setIsFilePlaying(false)
    setAudioMode('file')
    const name = analyzer.getCurrentFileName() ?? 'audio file'
    setStatus(`Paused ${name}.`)
  }

  const handlePresetPlay = async (track: PresetTrack) => {
    const analyzer = audioAnalyzerRef.current
    if (!analyzer) {
      setStatus('Audio analyzer not ready.')
      return
    }
    try {
      setStatus('Loading preset track...')
      await analyzer.setSourceFromUrl(track.url, track.name)
      analyzer.start()
      setAudioMode('file')
      setHasFile(true)
      setIsFilePlaying(true)
      setStatus(`Playing ${track.name}. Visuals are live.`)
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Unknown error while loading preset.'
      setStatus(`Preset error: ${message}`)
      console.error(error)
    }
  }

  const handleMicToggle = async () => {
    const analyzer = audioAnalyzerRef.current
    if (!analyzer) {
      setStatus('Audio analyzer not ready.')
      return
    }

    try {
      if (audioMode === 'mic') {
        await analyzer.stop()
        setAudioMode('idle')
        setStatus('Microphone stopped.')
        return
      }

      setStatus('Requesting microphone access...')
      await analyzer.setSourceFromMic()
      analyzer.start()
      setAudioMode('mic')
      setIsFilePlaying(false)
      setStatus('Mic live. Visuals respond to incoming audio.')
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Unknown microphone error.'
      setStatus(`Mic error: ${message}`)
      console.error(error)
    }
  }

  const handleStop = async () => {
    const analyzer = audioAnalyzerRef.current
    if (!analyzer) {
      setStatus('Audio analyzer not ready.')
      return
    }
    await analyzer.stop()
    setAudioMode('idle')
    setIsFilePlaying(false)
    setStatus('Playback stopped. Ready for a new source.')
  }

  return (
    <div className="vj-page">
      <header className="app-header">
        <h1 className="app-title">Live Visuals</h1>
        <p className="app-subtitle">
          Three canvas-driven looks for a browser-based VJ rig. Feed them a file or your mic.
        </p>
      </header>

      <section className="controls">
        <div className="control-group">
          <label htmlFor="vj-file-input" className="control-label">
            Load track (MP3/WAV)
          </label>
          <input
            id="vj-file-input"
            type="file"
            accept="audio/*"
            onChange={handleFileChange}
          />
        </div>

        <div className="control-group">
          <label className="control-label">Built-in tracks (drop files into src/assets/tracks)</label>
          {presetTracks.length ? (
            <ul className="preset-list">
              {presetTracks.map((track) => (
                <li key={track.id} className="preset-item">
                  <span className="preset-name">{track.name}</span>
                  <button type="button" onClick={() => handlePresetPlay(track)}>
                    Play
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <p className="preset-empty">No bundled tracks found. Add files to src/assets/tracks.</p>
          )}
        </div>

        <div className="control-group control-group-inline">
          <button
            type="button"
            onClick={handleFilePlay}
            disabled={!hasFile || isFilePlaying}
          >
            Play
          </button>
          <button
            type="button"
            onClick={handleFilePause}
            disabled={!hasFile || !isFilePlaying}
          >
            Pause
          </button>
        </div>

        <div className="control-group control-group-inline">
          <button type="button" onClick={handleMicToggle}>
            {audioMode === 'mic' ? 'Stop microphone' : 'Start microphone'}
          </button>
          <button type="button" onClick={handleStop} disabled={audioMode === 'idle'}>
            Stop playback
          </button>
        </div>
      </section>

      <section className="visual-mode-section">
        <div className="visual-mode-label">Pick a visual</div>
        <VisualModeButtons active={visualMode} onChange={setVisualMode} />
      </section>

      <section className="vj-canvas-wrapper">
        <canvas
          ref={canvasRef}
          width={1100}
          height={520}
          className="vj-canvas"
          aria-label="Audio reactive visual canvas"
        />
      </section>

      <section className="status-section">
        <div className="status-label">Status</div>
        <div className="status-text" aria-live="polite">
          {status}
        </div>
      </section>
    </div>
  )
}

export default VjVisuals

