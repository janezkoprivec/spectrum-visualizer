import { useEffect, useRef, useState } from 'react'
import './App.css'
import type { AudioMode } from './audio'
import { SpectrogramRenderer } from './spectrogram'
import type { FrequencyBand } from './AudioAnalyzer'
import { AudioAnalyzer } from './AudioAnalyzer'

interface BandTimeSeriesProps {
  histories: number[][]
  config: FrequencyBand[]
}

function BandTimeSeries({ histories, config }: BandTimeSeriesProps) {
  if (!histories.length || !config.length) return null

  const width = 100
  const height = 30

  return (
    <section className="bands-section">
      <div className="bands-header">
        <div className="bands-title">Frequency bands (time series, debug)</div>
        <div className="bands-caption">
          Recent smoothed energy per band (left = older, right = latest)
        </div>
      </div>

      <div className="bands-graph bands-graph-column">
        {config.map((band, index) => {
          const history = histories[index] ?? []
          const len = history.length

          let points = ''
          if (len >= 2) {
            points = history
              .map((value, i) => {
                const clamped = Math.max(0, Math.min(value, 1))
                const x = (i / (len - 1)) * width
                const y = height - clamped * height
                return `${x},${y}`
              })
              .join(' ')
          }

          return (
            <div key={band.id} className="band-row">
              <div className="band-label band-label-row">
                <span className="band-label-name">{band.label}</span>
                <span className="band-label-range">
                  {Math.round(band.minHz)}–{Math.round(band.maxHz)} Hz
                </span>
              </div>
              <svg
                className="band-series"
                viewBox={`0 0 ${width} ${height}`}
                preserveAspectRatio="none"
              >
                <rect
                  x="0"
                  y="0"
                  width={width}
                  height={height}
                  className="band-series-bg"
                />
                {points && (
                  <polyline
                    className="band-series-line"
                    fill="none"
                    points={points}
                  />
                )}
              </svg>
            </div>
          )
        })}
      </div>
    </section>
  )
}

function App() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const audioAnalyzerRef = useRef<AudioAnalyzer | null>(null)
  const rendererRef = useRef<SpectrogramRenderer | null>(null)

  const [mode, setMode] = useState<AudioMode>('idle')
  const [hasFile, setHasFile] = useState(false)
  const [isFilePlaying, setIsFilePlaying] = useState(false)
  const [status, setStatus] = useState<string>('Initializing audio context...')
  const [bandHistories, setBandHistories] = useState<number[][]>([])
  const [bandsConfig, setBandsConfig] = useState<FrequencyBand[]>([])

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return

    const audioAnalyzer = new AudioAnalyzer({ fftSize: 2048 })
    const config = audioAnalyzer.getBandsConfig()

    audioAnalyzerRef.current = audioAnalyzer

    const renderer = new SpectrogramRenderer(
      canvas,
      audioAnalyzer,
      {
        frequencyTicks: [100, 500, 1000, 2000, 5000, 10000],
      },
      (frame) => {
        // The same analysis frame that powers the spectrogram also feeds
        // the per-band time-series graphs below.
        setBandHistories((prev) => {
          const maxLength = 200
          const next: number[][] = frame.bands.map((value, bandIndex) => {
            const existing = prev[bandIndex] ?? []
            const updated =
              existing.length >= maxLength
                ? [...existing.slice(existing.length - maxLength + 1), value]
                : [...existing, value]
            return updated
          })
          return next
        })
      },
    )

    rendererRef.current = renderer

    // Initialize band config, histories, and status once on mount.
    renderer.start()

    // Defer React state initialization to the microtask queue so
    // it does not run synchronously within the effect body.
    queueMicrotask(() => {
      setStatus('Ready. Load an audio file or start the microphone.')
      setBandsConfig(config)
      setBandHistories(config.map(() => []))
    })

    return () => {
      renderer.stop()
      void audioAnalyzer.dispose()
      audioAnalyzerRef.current = null
      rendererRef.current = null
    }
  }, [])

  const handleFileChange: React.ChangeEventHandler<HTMLInputElement> = async (
    event,
  ) => {
    const file = event.target.files?.[0]
    if (!file) return

    const audioAnalyzer = audioAnalyzerRef.current
    if (!audioAnalyzer) {
      setStatus('Audio analyzer not ready.')
      return
    }

    try {
      setStatus('Loading and decoding file...')
      await audioAnalyzer.setSourceFromFile(file)
      setMode('file')
      setHasFile(true)
      setIsFilePlaying(false)
      setStatus(`File loaded: ${file.name}. Press Play to start.`)
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Unknown error while loading file.'
      setStatus(`File error: ${message}`)
      console.error(error)
    }
  }

  const handleFilePlay = () => {
    const audioAnalyzer = audioAnalyzerRef.current
    const renderer = rendererRef.current
    if (!audioAnalyzer) {
      setStatus('Audio analyzer not ready.')
      return
    }
    try {
      audioAnalyzer.start()
      renderer?.setPaused(false)
      setMode('file')
      const name = audioAnalyzer.getCurrentFileName() ?? 'audio file'
      setIsFilePlaying(true)
      setStatus(`File playing: ${name}`)
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Unable to start playback.'
      setStatus(`Play error: ${message}`)
      console.error(error)
    }
  }

  const handleFilePause = () => {
    const audioAnalyzer = audioAnalyzerRef.current
    const renderer = rendererRef.current
    if (!audioAnalyzer) {
      setStatus('Audio analyzer not ready.')
      return
    }
    audioAnalyzer.pauseFile()
    renderer?.setPaused(true)
    if (hasFile) {
      const name = audioAnalyzer.getCurrentFileName() ?? 'audio file'
      setStatus(`File paused: ${name}`)
    } else {
      setStatus('File paused.')
    }
    setIsFilePlaying(false)
    setMode('file')
  }

  const handleMicToggle = async () => {
    const audioAnalyzer = audioAnalyzerRef.current
    if (!audioAnalyzer) {
      setStatus('Audio analyzer not ready.')
      return
    }

    try {
      if (mode === 'mic') {
        await audioAnalyzer.stop()
        setMode('idle')
        setStatus('Microphone stopped.')
        return
      }

      setStatus('Requesting microphone access...')
      await audioAnalyzer.setSourceFromMic()
      audioAnalyzer.start()
      setMode('mic')
      setIsFilePlaying(false)
      setStatus('Mic live. Speak and watch the spectrogram.')
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Unknown microphone error.'
      setStatus(`Mic error: ${message}`)
      console.error(error)
    }
  }

  const handleStop = async () => {
    const audioAnalyzer = audioAnalyzerRef.current
    if (!audioAnalyzer) {
      setStatus('Audio analyzer not ready.')
      return
    }

    await audioAnalyzer.stop()
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

      <BandTimeSeries histories={bandHistories} config={bandsConfig} />

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
