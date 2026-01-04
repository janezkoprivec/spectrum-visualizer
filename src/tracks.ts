export interface PresetTrack {
  id: string
  name: string
  url: string
}

const presetTrackImports = import.meta.glob('./assets/tracks/*.{mp3,ogg,wav,flac}', {
  as: 'url',
  eager: true,
}) as Record<string, string>

export function getPresetTracks(): PresetTrack[] {
  return Object.entries(presetTrackImports).map(([path, url]) => {
    const file = path.split('/').pop() ?? 'track'
    const name = decodeURIComponent(file.replace(/\.[^.]+$/, '').replace(/[-_]+/g, ' '))
    return {
      id: file,
      name,
      url,
    }
  })
}

