import { useEffect, useRef, useState } from 'react'
import './App.css'
import type { AudioMode } from './audio'
import { AudioManager } from './audio'
import { SpectrogramRenderer } from './spectrogram'

function App() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const audioManagerRef = useRef<AudioManager | null>(null)
  const rendererRef = useRef<SpectrogramRenderer | null>(null)

  const [mode, setMode] = useState<AudioMode>('idle')
  const [hasFile, setHasFile] = useState(false)
  const [isFilePlaying, setIsFilePlaying] = useState(false)
  const [status, setStatus] = useState<string>('Initializing audio context...')

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) {
      setStatus('Canvas not available.')
      return
    }

    const audioManager = new AudioManager({ fftSize: 2048 })
    const analyser = audioManager.getAnalyser()

    const renderer = new SpectrogramRenderer(canvas, analyser, {
      frequencyTicks: [100, 500, 1000, 2000, 5000, 10000],
    })

    audioManagerRef.current = audioManager
    rendererRef.current = renderer

    renderer.start()
    setStatus('Ready. Load an audio file or start the microphone.')

    return () => {
      renderer.stop()
      void audioManager.dispose()
      audioManagerRef.current = null
      rendererRef.current = null
    }
  }, [])

  const handleFileChange: React.ChangeEventHandler<HTMLInputElement> = async (
    event,
  ) => {
    const file = event.target.files?.[0]
    if (!file) return

    const audioManager = audioManagerRef.current
    if (!audioManager) {
      setStatus('Audio manager not ready.')
      return
    }

    try {
      setStatus('Loading and decoding file...')
      await audioManager.loadFile(file)
      setMode('file')
      setHasFile(true)
      setIsFilePlaying(false)
      setStatus(`File loaded: ${file.name}. Press Play to start.`)
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Unknown error while loading file.'
      setStatus(`File error: ${message}`)
      // eslint-disable-next-line no-console
      console.error(error)
    }
  }

  const handleFilePlay = () => {
    const audioManager = audioManagerRef.current
    const renderer = rendererRef.current
    if (!audioManager) {
      setStatus('Audio manager not ready.')
      return
    }
    try {
      audioManager.playLoadedFile()
      renderer?.setPaused(false)
      setMode('file')
      const name = audioManager.getCurrentFileName() ?? 'audio file'
      setIsFilePlaying(true)
      setStatus(`File playing: ${name}`)
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Unable to start playback.'
      setStatus(`Play error: ${message}`)
      // eslint-disable-next-line no-console
      console.error(error)
    }
  }

  const handleFilePause = () => {
    const audioManager = audioManagerRef.current
    const renderer = rendererRef.current
    if (!audioManager) {
      setStatus('Audio manager not ready.')
      return
    }
    audioManager.pauseFile()
    renderer?.setPaused(true)
    if (hasFile) {
      const name = audioManager.getCurrentFileName() ?? 'audio file'
      setStatus(`File paused: ${name}`)
    } else {
      setStatus('File paused.')
    }
    setIsFilePlaying(false)
    setMode('file')
  }

  const handleMicToggle = async () => {
    const audioManager = audioManagerRef.current
    if (!audioManager) {
      setStatus('Audio manager not ready.')
      return
    }

    try {
      if (mode === 'mic') {
        await audioManager.stopCurrentSource()
        setMode('idle')
        setStatus('Microphone stopped.')
        return
      }

      setStatus('Requesting microphone access...')
      await audioManager.startMic()
      setMode('mic')
      setIsFilePlaying(false)
      setStatus('Mic live. Speak and watch the spectrogram.')
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Unknown microphone error.'
      setStatus(`Mic error: ${message}`)
      // eslint-disable-next-line no-console
      console.error(error)
    }
  }

  const handleStop = async () => {
    const audioManager = audioManagerRef.current
    if (!audioManager) {
      setStatus('Audio manager not ready.')
      return
    }

    await audioManager.stopCurrentSource()
    const previousMode = mode
    setMode('idle')
    setIsFilePlaying(false)
    if (previousMode === 'mic') {
      setStatus('Microphone stopped. Ready for a new source.')
    } else if (previousMode === 'file') {
      setStatus('Playback stopped. File is rewound to the beginning.')
    } else {
      setStatus('Nothing to stop.')
    }
  }

  return (
    <div className="app">
      <header className="app-header">
        <h1 className="app-title">Spectrum Visualizer</h1>
        <p className="app-subtitle">
          FFT-based spectrogram from file playback or live microphone
        </p>
      </header>

      <section className="controls">
        <div className="control-group">
          <label htmlFor="file-input" className="control-label">
            Load audio file (e.g. MP3, WAV)
          </label>
          <input
            id="file-input"
            type="file"
            accept="audio/*"
            onChange={handleFileChange}
          />
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
            {mode === 'mic' ? 'Stop microphone' : 'Start microphone'}
          </button>
          <button
            type="button"
            onClick={handleStop}
            disabled={mode === 'idle'}
          >
            Stop playback
          </button>
        </div>
      </section>

      <section className="canvas-section">
        <canvas
          ref={canvasRef}
          width={900}
          height={400}
          className="spectrogram-canvas"
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

export default App
