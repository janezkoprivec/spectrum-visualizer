import { BrowserRouter, NavLink, Route, Routes } from 'react-router-dom'
import './App.css'
import SpectrumLab from './pages/SpectrumLab'
import VjVisuals from './pages/VjVisuals'

function App() {
  return (
    <BrowserRouter>
      <div className="layout">
        <header className="shell-header">
          <div className="shell-title-block">
            <p className="app-kicker">Audio playground</p>
            <h1 className="shell-title">Spectrum Visualizer</h1>
            <p className="app-subtitle">
              Inspect the FFT or switch to a canvas-based VJ view for stage visuals.
            </p>
          </div>
          <nav className="top-nav" aria-label="Primary">
            <NavLink
              to="/"
              className={({ isActive }) =>
                `nav-link ${isActive ? 'nav-link-active' : ''}`
              }
              end
            >
              Live visuals
            </NavLink>
            <NavLink
              to="/spectrum-lab"
              className={({ isActive }) =>
                `nav-link ${isActive ? 'nav-link-active' : ''}`
              }
            >
              Spectrum lab
            </NavLink>
          </nav>
        </header>

        <main className="page-container">
          <Routes>
            <Route path="/" element={<VjVisuals />} />
            <Route path="/spectrum-lab" element={<SpectrumLab />} />
            <Route path="*" element={<VjVisuals />} />
          </Routes>
        </main>
      </div>
    </BrowserRouter>
  )
}

export default App
