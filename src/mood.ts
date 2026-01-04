export interface BandMeta {
  centerHz: number
}

export interface Palette {
  name: string
  background: string
  base: string
  accent: string
  ring: string
  particle: string
  highlight: string
}

export type PaletteName = 'metal' | 'electronic' | 'jazz' | 'funk' | 'pop'

const PALETTES: Record<PaletteName, Palette> = {
  metal: {
    name: 'Metal/Rock',
    background: 'hsl(220deg 21% 6%)',
    base: 'hsl(15deg 80% 52%)',
    accent: 'hsl(195deg 90% 62%)',
    ring: 'hsl(45deg 90% 62%)',
    particle: 'hsl(330deg 82% 64%)',
    highlight: 'hsl(200deg 95% 78%)',
  },
  electronic: {
    name: 'Electronic/EDM',
    background: 'hsl(210deg 50% 8%)',
    base: 'hsl(190deg 95% 55%)',
    accent: 'hsl(295deg 90% 65%)',
    ring: 'hsl(140deg 85% 58%)',
    particle: 'hsl(215deg 90% 64%)',
    highlight: 'hsl(55deg 95% 72%)',
  },
  jazz: {
    name: 'Jazz/Classical',
    background: 'hsl(250deg 38% 8%)',
    base: 'hsl(265deg 75% 55%)',
    accent: 'hsl(25deg 90% 62%)',
    ring: 'hsl(175deg 80% 58%)',
    particle: 'hsl(320deg 70% 62%)',
    highlight: 'hsl(205deg 90% 76%)',
  },
  funk: {
    name: 'Funk/Soul',
    background: 'hsl(280deg 35% 9%)',
    base: 'hsl(45deg 90% 58%)',
    accent: 'hsl(12deg 85% 62%)',
    ring: 'hsl(120deg 80% 55%)',
    particle: 'hsl(200deg 85% 60%)',
    highlight: 'hsl(310deg 90% 75%)',
  },
  pop: {
    name: 'Pop/Hip-Hop',
    background: 'hsl(230deg 45% 10%)',
    base: 'hsl(330deg 85% 60%)',
    accent: 'hsl(190deg 85% 60%)',
    ring: 'hsl(45deg 95% 60%)',
    particle: 'hsl(280deg 80% 65%)',
    highlight: 'hsl(150deg 95% 70%)',
  },
}

export function getPalette(name: PaletteName): Palette {
  return PALETTES[name]
}

export function getAllPaletteNames(): PaletteName[] {
  return Object.keys(PALETTES) as PaletteName[]
}

export function getPaletteInfo(name: PaletteName): { name: PaletteName; displayName: string } {
  return {
    name,
    displayName: PALETTES[name].name,
  }
}

