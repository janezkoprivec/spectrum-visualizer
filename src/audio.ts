export type AudioMode = 'idle' | 'file' | 'mic'

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
