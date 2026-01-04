This is a project for Digital Sound Production course at Facutly of Computer Science and Informatics in Ljubljana. 

Spectrum Visualizer visualizes audio from a file or the microphone using a scrolling FFT-based spectrogram and a small set of musical frequency bands.

## Audio analyzer

The Web Audio wiring and FFT aggregation live in `AudioAnalyzer`:

- `setSourceFromFile(file: File)` – decode a file and prepare it as the current source.
- `setSourceFromMic()` – request microphone access and prepare it as the current source.
- `start()` / `pauseFile()` / `stop()` – control playback (file) or capture (mic).
- `getFrame()` – returns:
  - `fftMagnitudes: Float32Array` – raw FFT magnitudes in dB (for the spectrogram).
  - `bands: number[]` – smoothed band energies in [0, 1] for the debug band graph.

To switch between file and mic modes in React:

- **File mode**
  - `await audioAnalyzer.setSourceFromFile(file)`
  - `audioAnalyzer.start()` to play
  - `audioAnalyzer.pauseFile()` to pause
  - `audioAnalyzer.stop()` to stop and rewind

- **Mic mode**
  - `await audioAnalyzer.setSourceFromMic()`
  - `audioAnalyzer.start()` to begin visualizing the mic
  - `audioAnalyzer.stop()` to stop

Both the spectrogram and the band graph share the same `AnalyzerFrame` from `getFrame()`, so the full spectrum and the per-band bars stay in sync each animation frame.