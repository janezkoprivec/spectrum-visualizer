import { useEffect, useRef, useState } from 'react'
import '../App.css'
import type { AudioMode } from '../audio'
import { AudioAnalyzer } from '../AudioAnalyzer'
import type { PresetTrack } from '../tracks'
import { getPresetTracks } from '../tracks'
import type { Palette, PaletteName } from '../mood'
import { getPalette, getAllPaletteNames, getPaletteInfo } from '../mood'

type VisualMode = 'hybrid' | 'star' | 'orbit'

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
  hybrid: 'Pulse + sparks',
  star: 'Frequency star',
  orbit: 'Frequency orbit',
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

  const ringBase = Math.min(width, height) / 8.5
  const ringLevels: Array<{ level: number; hue: number }> = [
    { level: sub, hue: 210 },
    { level: bass, hue: 260 },
  ]

  const innerRingMinRadius = ringBase

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

  const maxWaveformSize = (innerRingMinRadius - 12) * 2
  const waveformWidth = Math.min(maxWaveformSize * 0.9, 500)
  const waveformHeight = Math.min(maxWaveformSize * 0.45, 120)
  const waveformX = cx - waveformWidth / 2
  const barWidth = waveformWidth / bands.length
  const barSpacing = barWidth * 0.15
  const cornerRadius = Math.min(3, (barWidth - barSpacing) / 2)

  ctx.globalCompositeOperation = 'lighter'
  bands.forEach((value, index) => {
    const barHeight = Math.max(4, value * waveformHeight)
    const x = waveformX + index * barWidth + barSpacing / 2
    const barY = cy - barHeight / 2
    const barActualWidth = barWidth - barSpacing
    
    ctx.fillStyle = withAlpha(palette.accent, 0.95)
    ctx.beginPath()
    ctx.roundRect(x, barY, barActualWidth, barHeight, cornerRadius)
    ctx.fill()
    
    if (value > 0.2) {
      ctx.fillStyle = withAlpha(palette.highlight, value * 0.4)
      ctx.beginPath()
      ctx.roundRect(x, barY, barActualWidth, Math.min(barHeight, 3), [cornerRadius, cornerRadius, 0, 0])
      ctx.fill()
    }
  })
  
  ctx.globalCompositeOperation = 'source-over'

  const avgEnergy = bands.reduce((a, b) => a + b, 0) / Math.max(bands.length, 1)
  const bandCount = Math.max(bands.length, 1)
  const exclusionRadius = outerRing + 10
  const maxRadius = Math.max(width, height) * 0.65

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
    const baseSize = 3 + bandEnergy * 22 * p.life
    const energyBoost = Math.pow(bandEnergy, 1.5) * 10
    const size = baseSize + energyBoost
    const alpha = 0.3 + Math.min(0.5, bandEnergy * 0.9)
    const dx = p.x - cx
    const dy = p.y - cy
    const dist = Math.sqrt(dx * dx + dy * dy)

    if (dist < exclusionRadius) {
      return
    }

    const tailLength = 12 + bandEnergy * 15
    ctx.lineCap = 'round'
    ctx.strokeStyle = withAlpha(palette.particle, alpha * 0.7)
    ctx.lineWidth = Math.max(1, size * 0.2)
    ctx.beginPath()
    ctx.moveTo(p.x, p.y)
    ctx.lineTo(p.x - p.vx * tailLength, p.y - p.vy * tailLength)
    ctx.stroke()

    const glowRadius = size * 2.5
    const gradient = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, glowRadius)
    gradient.addColorStop(0, withAlpha(palette.particle, alpha * 0.8))
    gradient.addColorStop(0.5, withAlpha(palette.particle, alpha * 0.4))
    gradient.addColorStop(1, 'rgba(0, 0, 0, 0)')
    ctx.fillStyle = gradient
    ctx.beginPath()
    ctx.arc(p.x, p.y, glowRadius, 0, Math.PI * 2)
    ctx.fill()
  })
  ctx.globalCompositeOperation = 'source-over'
}

function drawStar(
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

  const spectrumRadius = Math.min(width, height) / 9
  const barCount = bands.length
  const totalBars = barCount * 2
  const anglePerBar = (Math.PI * 2) / totalBars
  const rotationOffset = (15 * Math.PI) / 180
  
  ctx.globalCompositeOperation = 'lighter'
  
  for (let i = 0; i < totalBars; i++) {
    let bandIndex: number
    if (i < barCount) {
      bandIndex = barCount - 1 - i
    } else {
      bandIndex = i - barCount
    }
    
    const value = bands[bandIndex] ?? 0
    const angle = i * anglePerBar - Math.PI / 2 + rotationOffset
    const barLength = value * 150 + 20
    const innerRadius = spectrumRadius
    const outerRadius = innerRadius + barLength
    const x1 = cx + Math.cos(angle) * innerRadius
    const y1 = cy + Math.sin(angle) * innerRadius
    const x2 = cx + Math.cos(angle) * outerRadius
    const y2 = cy + Math.sin(angle) * outerRadius
    
    const gradient = ctx.createLinearGradient(x1, y1, x2, y2)
    gradient.addColorStop(0, withAlpha(palette.base, 0.9))
    gradient.addColorStop(0.5, withAlpha(palette.accent, value * 0.8))
    gradient.addColorStop(1, withAlpha(palette.highlight, value))
    
    ctx.strokeStyle = gradient
    ctx.lineWidth = Math.max(4, (Math.PI * 2 * innerRadius) / totalBars * 0.9)
    ctx.lineCap = 'round'
    ctx.beginPath()
    ctx.moveTo(x1, y1)
    ctx.lineTo(x2, y2)
    ctx.stroke()
    
    if (value > 0.5) {
      ctx.beginPath()
      ctx.arc(x2, y2, value * 8, 0, Math.PI * 2)
      const tipGradient = ctx.createRadialGradient(x2, y2, 0, x2, y2, value * 8)
      tipGradient.addColorStop(0, withAlpha(palette.highlight, value * 0.8))
      tipGradient.addColorStop(1, 'rgba(0, 0, 0, 0)')
      ctx.fillStyle = tipGradient
      ctx.fill()
    }
  }
  
  ctx.beginPath()
  for (let i = 0; i < totalBars; i++) {
    let bandIndex: number
    if (i < barCount) {
      bandIndex = barCount - 1 - i
    } else {
      bandIndex = i - barCount
    }
    const value = bands[bandIndex] ?? 0
    const angle = i * anglePerBar - Math.PI / 2 + rotationOffset
    const barLength = value * 150 + 20
    const radius = spectrumRadius + barLength
    const x = cx + Math.cos(angle) * radius
    const y = cy + Math.sin(angle) * radius
    if (i === 0) {
      ctx.moveTo(x, y)
    } else {
      ctx.lineTo(x, y)
    }
  }
  ctx.closePath()
  ctx.strokeStyle = withAlpha(palette.accent, 0.5)
  ctx.lineWidth = 3
  ctx.stroke()
  
  ctx.fillStyle = withAlpha(palette.base, 0.15)
  ctx.fill()
  
  const avgEnergy = bands.reduce((a, b) => a + b, 0) / Math.max(bands.length, 1)
  const centerPulse = avgEnergy
  const centerRadius = spectrumRadius * (0.7 + centerPulse * 0.4)
  ctx.beginPath()
  ctx.arc(cx, cy, centerRadius, 0, Math.PI * 2)
  const centerGradient = ctx.createRadialGradient(cx, cy, 0, cx, cy, centerRadius)
  centerGradient.addColorStop(0, withAlpha(palette.highlight, 0.95))
  centerGradient.addColorStop(0.5, withAlpha(palette.accent, 0.6))
  centerGradient.addColorStop(1, withAlpha(palette.base, 0.2))
  ctx.fillStyle = centerGradient
  ctx.fill()
  
  const rotationSpeed = avgEnergy * 0.02
  const time = Date.now() * 0.001
  const numLines = 3
  for (let i = 0; i < numLines; i++) {
    const lineAngle = (i / numLines) * Math.PI * 2 + time * rotationSpeed
    const lineLength = spectrumRadius * 0.5
    const x1 = cx + Math.cos(lineAngle) * lineLength
    const y1 = cy + Math.sin(lineAngle) * lineLength
    const x2 = cx + Math.cos(lineAngle + Math.PI) * lineLength
    const y2 = cy + Math.sin(lineAngle + Math.PI) * lineLength
    
    ctx.strokeStyle = withAlpha(palette.ring, 0.4)
    ctx.lineWidth = 2
    ctx.beginPath()
    ctx.moveTo(x1, y1)
    ctx.lineTo(x2, y2)
    ctx.stroke()
  }
  
  ctx.globalCompositeOperation = 'source-over'

  const bandCount = Math.max(bands.length, 1)
  const maxRadius = Math.max(width, height) * 0.7

  particles.forEach((p) => {
    const bandEnergy = bands[p.band] ?? avgEnergy
    const speed = 0.5 + bandEnergy * 2.5
    p.x += p.vx * speed * 5
    p.y += p.vy * speed * 5
    p.life -= 0.004 + bandEnergy * 0.008

    const dx = p.x - cx
    const dy = p.y - cy
    const dist = Math.sqrt(dx * dx + dy * dy)

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
    const size = 2 + bandEnergy * 12 * p.life
    const alpha = 0.4 + Math.min(0.6, bandEnergy * 1.0)

    ctx.strokeStyle = withAlpha(palette.particle, alpha * 0.7)
    ctx.lineWidth = Math.max(1, size * 0.2)
    ctx.beginPath()
    ctx.moveTo(p.x, p.y)
    ctx.lineTo(p.x - p.vx * 15, p.y - p.vy * 15)
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

function drawOrbit(
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
  const spectrumRadius = Math.min(width, height) / 9
  const barCount = bands.length
  const totalBars = barCount * 2
  const anglePerBar = (Math.PI * 2) / totalBars
  
  const time = Date.now() * 0.001
  const spinSpeed = 0.3
  const rotationOffset = (15 * Math.PI) / 180 + time * spinSpeed

  const points: Array<{ x: number; y: number; value: number }> = []
  for (let i = 0; i < totalBars; i++) {
    let bandIndex: number
    if (i < barCount) {
      bandIndex = barCount - 1 - i
    } else {
      bandIndex = i - barCount
    }
    const value = bands[bandIndex] ?? 0
    const angle = i * anglePerBar - Math.PI / 2 + rotationOffset
    const barLength = value * 220 + 20
    const radius = spectrumRadius + barLength
    const x = cx + Math.cos(angle) * radius
    const y = cy + Math.sin(angle) * radius
    points.push({ x, y, value })
  }

  ctx.globalCompositeOperation = 'lighter'
  ctx.beginPath()
  
  ctx.moveTo(points[0].x, points[0].y)
  
  for (let i = 0; i < points.length; i++) {
    const current = points[i]
    const next = points[(i + 1) % points.length]
    
    const midX = (current.x + next.x) / 2
    const midY = (current.y + next.y) / 2
    ctx.quadraticCurveTo(current.x, current.y, midX, midY)
  }
  
  ctx.closePath()
  
  ctx.strokeStyle = withAlpha(palette.accent, 0.7)
  ctx.lineWidth = 5
  ctx.stroke()

  ctx.strokeStyle = withAlpha(palette.highlight, 0.4)
  ctx.lineWidth = 2
  ctx.stroke()

  ctx.fillStyle = withAlpha(palette.base, 0.1)
  ctx.fill()

  ctx.globalCompositeOperation = 'source-over'

  const avgCircleRadius = points.reduce((sum, p) => {
    const dx = p.x - cx
    const dy = p.y - cy
    return sum + Math.sqrt(dx * dx + dy * dy)
  }, 0) / points.length

  const maxWaveformSize = (spectrumRadius - 12) * 2
  const waveformWidth = Math.min(maxWaveformSize * 1.35, 750)
  const waveformHeight = Math.min(maxWaveformSize * 0.68, 180)
  const waveformX = cx - waveformWidth / 2
  const barWidth = waveformWidth / bands.length
  const barSpacing = barWidth * 0.15
  const cornerRadius = Math.min(3, (barWidth - barSpacing) / 2)

  ctx.globalCompositeOperation = 'lighter'
  bands.forEach((value, index) => {
    const barHeight = Math.max(4, value * waveformHeight)
    const x = waveformX + index * barWidth + barSpacing / 2
    const barY = cy - barHeight / 2
    const barActualWidth = barWidth - barSpacing
    
    ctx.fillStyle = withAlpha(palette.accent, 0.95)
    ctx.beginPath()
    ctx.roundRect(x, barY, barActualWidth, barHeight, cornerRadius)
    ctx.fill()
    
    if (value > 0.2) {
      ctx.fillStyle = withAlpha(palette.highlight, value * 0.4)
      ctx.beginPath()
      ctx.roundRect(x, barY, barActualWidth, Math.min(barHeight, 3), [cornerRadius, cornerRadius, 0, 0])
      ctx.fill()
    }
  })
  
  ctx.globalCompositeOperation = 'source-over'

  const avgEnergy = bands.reduce((a, b) => a + b, 0) / Math.max(bands.length, 1)
  const exclusionRadius = avgCircleRadius + 40
  const maxRadius = Math.max(width, height) * 0.7

  particles.forEach((p) => {
    const bandEnergy = bands[p.band] ?? avgEnergy
    const speed = 0.5 + bandEnergy * 2.5
    p.x += p.vx * speed * 5
    p.y += p.vy * speed * 5
    p.life -= 0.004 + bandEnergy * 0.008

    const dx = p.x - cx
    const dy = p.y - cy
    const dist = Math.sqrt(dx * dx + dy * dy)

    if (dist < exclusionRadius) {
      const push = (exclusionRadius - dist) * 0.5
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
      const spawnAngle = Math.random() * Math.PI * 2
      const spawnDist = exclusionRadius + 10 + Math.random() * 30
      
      p.x = cx + Math.cos(spawnAngle) * spawnDist
      p.y = cy + Math.sin(spawnAngle) * spawnDist
      
      const speed = 0.35 + Math.random() * 0.6
      p.vx = Math.cos(spawnAngle) * speed
      p.vy = Math.sin(spawnAngle) * speed
      p.life = 0.8 + Math.random() * 0.8
      p.band = Math.floor(Math.random() * bands.length)
    }
  })

  ctx.globalCompositeOperation = 'lighter'
  particles.forEach((p) => {
    const bandEnergy = bands[p.band] ?? avgEnergy
    const dx = p.x - cx
    const dy = p.y - cy
    const dist = Math.sqrt(dx * dx + dy * dy)
    const particleAngle = Math.atan2(dy, dx)
    
    let closestBumpEnergy = 0
    for (let i = 0; i < totalBars; i++) {
      let bandIndex: number
      if (i < barCount) {
        bandIndex = barCount - 1 - i
      } else {
        bandIndex = i - barCount
      }
      const bumpAngle = i * anglePerBar - Math.PI / 2 + rotationOffset
      const angleDiff = Math.abs(Math.atan2(Math.sin(particleAngle - bumpAngle), Math.cos(particleAngle - bumpAngle)))
      
      if (angleDiff < anglePerBar) {
        closestBumpEnergy = Math.max(closestBumpEnergy, bands[bandIndex] ?? 0)
      }
    }
    
    const energyBoost = 1 + closestBumpEnergy * 4
    const size = (2 + bandEnergy * 12 * p.life) * energyBoost
    const alpha = (0.3 + Math.min(0.4, bandEnergy * 0.8)) * Math.min(0.6, energyBoost * 0.4)

    if (dist < exclusionRadius) {
      return
    }

    const tailLength = 15 * Math.pow(energyBoost, 1.3)
    ctx.lineCap = 'round'
    ctx.strokeStyle = withAlpha(palette.particle, alpha * 0.7)
    ctx.lineWidth = Math.max(1, size * 0.2)
    ctx.beginPath()
    ctx.moveTo(p.x, p.y)
    ctx.lineTo(p.x - p.vx * tailLength, p.y - p.vy * tailLength)
    ctx.stroke()

    const gradient = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, size * 2.5)
    gradient.addColorStop(0, withAlpha(palette.particle, alpha))
    gradient.addColorStop(1, 'rgba(0, 0, 0, 0)')
    ctx.fillStyle = gradient
    ctx.beginPath()
    ctx.arc(p.x, p.y, size * 2.5, 0, Math.PI * 2)
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
    case 'hybrid':
      drawHybrid(ctx, width, height, bands, particles, palette)
      break
    case 'star':
      drawStar(ctx, width, height, bands, particles, palette)
      break
    case 'orbit':
      drawOrbit(ctx, width, height, bands, particles, palette)
      break
  }
}

function PaletteButtons({
  active,
  onChange,
}: {
  active: PaletteName
  onChange: (palette: PaletteName) => void
}) {
  const paletteNames = getAllPaletteNames()
  
  return (
    <div className="visual-mode-toggle">
      {paletteNames.map((paletteName) => {
        const info = getPaletteInfo(paletteName)
        const isActive = active === paletteName
        return (
          <button
            key={paletteName}
            type="button"
            className={`visual-mode-button ${isActive ? 'active' : ''}`}
            onClick={() => onChange(paletteName)}
          >
            {info.displayName}
          </button>
        )
      })}
    </div>
  )
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
  const visualModeRef = useRef<VisualMode>('hybrid')
  const paletteNameRef = useRef<PaletteName>('metal')

  const presetTracks = getPresetTracks()
  const [audioMode, setAudioMode] = useState<AudioMode>('idle')
  const [status, setStatus] = useState('Initializing audio context...')
  const [hasFile, setHasFile] = useState(false)
  const [isFilePlaying, setIsFilePlaying] = useState(false)
  const [visualMode, setVisualMode] = useState<VisualMode>('hybrid')
  const [paletteName, setPaletteName] = useState<PaletteName>('metal')
  const [currentTrack, setCurrentTrack] = useState<string | null>(null)
  const [isFullscreen, setIsFullscreen] = useState(false)

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
    const bandCount = bandConfig.length
    particlesRef.current = createParticles(220, canvas.width, canvas.height, bandCount)
    queueMicrotask(() =>
      setStatus('Ready. Load a track or open the mic, then pick a visual.'),
    )

    const loop = () => {
      const frame = analyzer.getFrame()
      const palette = getPalette(paletteNameRef.current)
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

  useEffect(() => {
    paletteNameRef.current = paletteName
  }, [paletteName])

  useEffect(() => {
    const handleFullscreenChange = () => {
      setIsFullscreen(!!document.fullscreenElement)
      const canvas = canvasRef.current
      if (canvas) {
        if (document.fullscreenElement) {
          canvas.width = window.screen.width
          canvas.height = window.screen.height
          const bandCount = audioAnalyzerRef.current?.getBandsConfig().length ?? 6
          particlesRef.current = createParticles(220, canvas.width, canvas.height, bandCount)
        } else {
          canvas.width = 1100
          canvas.height = 520
          const bandCount = audioAnalyzerRef.current?.getBandsConfig().length ?? 6
          particlesRef.current = createParticles(220, canvas.width, canvas.height, bandCount)
        }
      }
    }

    document.addEventListener('fullscreenchange', handleFullscreenChange)
    return () => {
      document.removeEventListener('fullscreenchange', handleFullscreenChange)
    }
  }, [])

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
      setCurrentTrack(file.name)
      setStatus(`Loaded: ${file.name}. Hit Play to start the VJ view.`)
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Unknown error while loading file.'
      setStatus(`File error: ${message}`)
      console.error(error)
    }
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
      setCurrentTrack(track.name)
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
        setCurrentTrack(null)
        return
      }

      setStatus('Requesting microphone access...')
      await analyzer.setSourceFromMic()
      analyzer.start()
      setAudioMode('mic')
      setIsFilePlaying(false)
      setCurrentTrack('Live microphone')
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
    setCurrentTrack(null)
    setStatus('Playback stopped. Ready for a new source.')
  }

  const handleTogglePlayPause = () => {
    const analyzer = audioAnalyzerRef.current
    if (!analyzer || audioMode !== 'file' || !hasFile) return

    if (isFilePlaying) {
      analyzer.pauseFile()
      setIsFilePlaying(false)
      const name = analyzer.getCurrentFileName() ?? currentTrack ?? 'audio file'
      setStatus(`Paused ${name}.`)
    } else {
      analyzer.start()
      setIsFilePlaying(true)
      const name = analyzer.getCurrentFileName() ?? currentTrack ?? 'audio file'
      setStatus(`Playing ${name}. Visuals are live.`)
    }
  }

  const nowPlayingLabel =
    audioMode === 'mic'
      ? 'Live microphone feed'
      : currentTrack ?? 'No track loaded'

  const handleFullscreenToggle = async () => {
    const canvas = canvasRef.current
    if (!canvas) return

    try {
      if (!document.fullscreenElement) {
        await canvas.requestFullscreen()
        setStatus('Fullscreen mode activated. Press ESC to exit.')
      } else {
        await document.exitFullscreen()
        setStatus('Exited fullscreen mode.')
      }
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Failed to toggle fullscreen.'
      setStatus(`Fullscreen error: ${message}`)
      console.error(error)
    }
  }

  return (
    <div className="vj-page">
      <header className="app-header">
        <h1 className="app-title">Live Visuals</h1>
        <p className="app-subtitle">
          Three canvas-driven looks for a browser-based VJ rig. Feed them a file or your mic.
        </p>
      </header>

      <div className="vj-content">
        <aside className="vj-control-panel">
          <section className="control-card">
            <div className="control-card-title">Load track (MP3/WAV)</div>
            <input
              id="vj-file-input"
              type="file"
              accept="audio/*"
              onChange={handleFileChange}
            />
          </section>

          <section className="control-card">
            <div className="control-card-title">
              Built-in tracks (drop files into src/assets/tracks)
            </div>
            {presetTracks.length ? (
              <ul className="preset-list">
                {presetTracks.map((track) => (
                  <li key={track.id} className="preset-item">
                    <span className="preset-name">{track.name}</span>
                  <button
                    type="button"
                    onClick={() => handlePresetPlay(track)}
                    aria-label={`Play ${track.name}`}
                    title="Play"
                  >
                    ▶
                  </button>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="preset-empty">No bundled tracks found. Add files to src/assets/tracks.</p>
            )}
          </section>

          <section className="control-card">
            <div className="control-card-title">Playback &amp; Microphone</div>
            <div className="control-actions-row">
              <button type="button" onClick={handleMicToggle}>
                {audioMode === 'mic' ? 'Stop microphone' : 'Start microphone'}
              </button>
              <button type="button" onClick={handleStop} disabled={audioMode === 'idle'}>
                Stop playback
              </button>
            </div>
          </section>

          <section className="status-section">
            <div className="status-label">Now playing</div>
            <div className="status-text" aria-live="polite">
              {nowPlayingLabel}
            </div>
            {audioMode === 'file' && hasFile ? (
              <div className="control-actions-row">
                <button
                  type="button"
                  onClick={handleTogglePlayPause}
                  aria-label={isFilePlaying ? 'Pause' : 'Play'}
                  title={isFilePlaying ? 'Pause' : 'Play'}
                >
                  {isFilePlaying ? '⏸' : '▶'}
                </button>
              </div>
            ) : null}
            <div className="status-text" aria-live="polite">
              {status}
            </div>
          </section>
        </aside>

        <div className="vj-visual-column">
          <div className="vj-visual-toolbar">
            <section className="visual-mode-section toolbar-section">
              <div className="visual-mode-label">Pick a visual</div>
              <VisualModeButtons active={visualMode} onChange={setVisualMode} />
            </section>

            <section className="visual-mode-section toolbar-section">
              <div className="visual-mode-label">Pick a color palette</div>
              <PaletteButtons active={paletteName} onChange={setPaletteName} />
            </section>
          </div>

          <section className="vj-canvas-wrapper">
            <canvas
              ref={canvasRef}
              width={1100}
              height={520}
              className="vj-canvas"
              aria-label="Audio reactive visual canvas"
            />
            <button
              type="button"
              className="fullscreen-button"
              onClick={handleFullscreenToggle}
              title={isFullscreen ? 'Exit fullscreen (ESC)' : 'Enter fullscreen'}
            >
              {isFullscreen ? '⛶' : '⛶'}
            </button>
          </section>
        </div>
      </div>
    </div>
  )
}

export default VjVisuals

