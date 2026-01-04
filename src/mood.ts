export interface BandMeta {
  centerHz: number
}

export interface MoodState {
  /**
   * Overall loudness / intensity in [0,1].
   */
  energy: number
  /**
   * Spectral brightness in [0,1] (low = warm/dark, high = bright/cool).
   */
  brightness: number
  /**
   * Short-term dynamics / variance in [0,1].
   */
  dynamics: number
}

export interface Palette {
  background: string
  base: string
  accent: string
  ring: string
  particle: string
  highlight: string
}

const DEFAULT_MOOD: MoodState = { energy: 0.2, brightness: 0.4, dynamics: 0.3 }

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value))
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t
}

/**
 * Update a smoothed mood state from current band energies and band metadata.
 */
export function updateMoodFromBands(
  prev: MoodState | undefined,
  bands: number[],
  meta: BandMeta[],
): MoodState {
  if (!bands.length || !meta.length) return prev ?? DEFAULT_MOOD
  const state = prev ?? DEFAULT_MOOD

  const energyRaw = bands.reduce((a, b) => a + b, 0) / bands.length

  // Ratio-based brightness detection: compare low vs high frequency energy.
  // This is more reliable than spectral centroid for detecting "warm" vs "bright" music.
  // 
  // We expect bands in this order (based on typical setup):
  // 0: Sub (20-60 Hz)
  // 1: Bass (60-250 Hz)
  // 2: Low-mid (250-500 Hz)
  // 3: Mid (500-2000 Hz)
  // 4: Presence (2000-6000 Hz)
  // 5: Brilliance (6000-16000 Hz)
  
  // Calculate low energy (sub + bass + low-mid)
  let lowEnergy = 0
  let midEnergy = 0
  let highEnergy = 0
  
  for (let i = 0; i < bands.length; i++) {
    const freq = meta[i]?.centerHz ?? 0
    const energy = bands[i] ?? 0
    
    if (freq < 500) {
      lowEnergy += energy
    } else if (freq < 2000) {
      midEnergy += energy
    } else {
      highEnergy += energy
    }
  }
  
  // Normalize by the number of bands in each category to get averages
  const totalEnergy = lowEnergy + midEnergy + highEnergy
  if (totalEnergy > 0.001) {
    lowEnergy /= totalEnergy
    midEnergy /= totalEnergy
    highEnergy /= totalEnergy
  }
  
  // Brightness based on high frequency ratio with boost
  // Low brightness (0.0-0.3) = bass/low-mid dominant -> warm colors (red/orange)
  // Mid brightness (0.3-0.6) = balanced -> yellow/green  
  // High brightness (0.6-1.0) = treble dominant -> cyan/blue/purple
  const highRatio = highEnergy
  const lowRatio = lowEnergy
  const brightnessRaw = clamp01(highRatio * 2.5 - lowRatio * 0.5)

  // Short-term dynamics: variance of band energies.
  const mean = energyRaw
  const variance =
    bands.reduce((sum, v) => sum + (v - mean) * (v - mean), 0) / Math.max(1, bands.length - 1)
  // Variance scale heuristic.
  const dynamicsRaw = clamp01(variance * 4)

  // Smooth to avoid flicker.
  const alpha = 0.15
  return {
    energy: state.energy * (1 - alpha) + energyRaw * alpha,
    brightness: state.brightness * (1 - alpha) + brightnessRaw * alpha,
    dynamics: state.dynamics * (1 - alpha) + dynamicsRaw * alpha,
  }
}

/**
 * Map mood to a palette.
 *
 * energy -> saturation/contrast
 * brightness -> hue temperature
 * dynamics -> accent boost
 */
export function paletteFromMood(mood: MoodState): Palette {
  const energy = clamp01(mood.energy)
  const temperature = clamp01(mood.brightness)
  const dynamics = clamp01(mood.dynamics)

  // Base hue sweeps through a wider range: red -> yellow -> green -> cyan -> blue -> purple
  // Low brightness (warm, bass-heavy) = reds/oranges (0-30°)
  // Mid brightness = greens/cyans (120-180°)
  // High brightness (treble, bright) = blues/purples (240-280°)
  const baseHue = lerp(0, 280, temperature)
  const baseSat = lerp(65, 85, energy) // energy affects saturation
  const baseLight = lerp(42, 50, temperature)
  const base = `hsl(${baseHue}deg ${baseSat}% ${baseLight}%)`

  // Accent hue uses complementary or triadic relationships for more variety
  // High dynamics = more dramatic color shifts
  const hueShift = lerp(60, 150, dynamics) // dynamics creates bigger jumps
  const accentHue = (baseHue + hueShift + lerp(-30, 30, energy)) % 360
  const accentSat = lerp(75, 98, energy)
  const accentLight = lerp(50, 68, energy)
  const accent = `hsl(${accentHue}deg ${accentSat}% ${accentLight}%)`

  // Background contrasts with base hue
  const bgHue = (baseHue + 180) % 360 // complementary for contrast
  const bgSat = lerp(25, 45, energy)
  const bgLight = lerp(6, 12, energy)
  const background = `hsl(${bgHue}deg ${bgSat}% ${bgLight}%)`

  // Ring uses a split-complementary approach
  const ringHue = (baseHue + lerp(120, 240, dynamics)) % 360
  const ring = `hsl(${ringHue}deg ${lerp(80, 95, energy)}% ${lerp(55, 70, energy)}%)`

  // Particle color varies with dynamics for visual interest
  const particleHue = (accentHue + lerp(-45, 45, dynamics)) % 360
  const particle = `hsl(${particleHue}deg ${lerp(70, 90, energy)}% ${lerp(55, 72, energy)}%)`

  // Highlight is very bright and saturated
  const highlightHue = (accentHue + lerp(0, 30, dynamics)) % 360
  const highlight = `hsl(${highlightHue}deg 100% ${lerp(72, 90, energy)}%)`

  return {
    background,
    base,
    accent,
    ring,
    particle,
    highlight,
  }
}

