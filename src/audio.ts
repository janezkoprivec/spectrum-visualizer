export type AudioMode = 'idle' | 'file' | 'mic'

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
 * This file now contains only small, reusable audio helpers and shared types.
 * The higher-level playback + FFT analysis logic lives in `AudioAnalyzer`.
 */
