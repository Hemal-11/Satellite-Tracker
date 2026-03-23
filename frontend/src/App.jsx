import { useEffect, useState, useRef } from "react";
import CesiumMap from "./CesiumMap";
import "./App.css";
import "./logo.css";
import SkyView from "./SkyView";

const API_BASE = "https://satellite-tracker-api.onrender.com";

export default function App() {
  const [satellites, setSatellites] = useState([]);
  const [highlightedNorad, setHighlightedNorad] = useState(null);
  const [selectedSatellite, setSelectedSatellite] = useState(null);

  const [totalSats, setTotalSats] = useState(0);
  const [visibleSats, setVisibleSats] = useState(0);
  const [satStats, setSatStats] = useState({ leo: 0, meo: 0, geo: 0 });
  const [trackingNorad, setTrackingNorad] = useState(null);

  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState([]);

  const [passes, setPasses] = useState([]);
  const [bestPass, setBestPass] = useState(null);
  const [passError, setPassError] = useState(null);
  const [loadingPasses, setLoadingPasses] = useState(false);
  const [showPassPanel, setShowPassPanel] = useState(false);
  const [showAllPasses, setShowAllPasses] = useState(false);

  const [observerLocation, setObserverLocation] = useState(null);
  const [countdown, setCountdown] = useState(null);

  const [searchIndex, setSearchIndex] = useState(-1);
  const [maxRender, setMaxRender] = useState(() => window.innerWidth <= 900 ? 1500 : 3000);
  const [timeOffsetHours, setTimeOffsetHours] = useState(0);
  const [orbitFilters, setOrbitFilters] = useState({
    LEO: true,
    MEO: true,
    GEO: true,
  });

  const [categoryFilters, setCategoryFilters] = useState({
    station: true,
    comm: true,
    nav: true,
    earth: true,
    military: true,
    science: true,
    "Unknown (publicly unavailable)": true,
  });

  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const [viewMode, setViewMode] = useState("globe");
  const [isTransitioningToSky, setIsTransitioningToSky] = useState(false);
  const touchStartY = useRef(0);
  const [apiError, setApiError] = useState(null);

  const [isMobile, setIsMobile] = useState(window.innerWidth <= 900);

  useEffect(() => {
    const handleResize = () => setIsMobile(window.innerWidth <= 900);
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, []);

  /* LOCATION PREFETCH */
  useEffect(() => {
    if (navigator.geolocation && !observerLocation) {
      navigator.geolocation.getCurrentPosition(
        (pos) => setObserverLocation({ lat: pos.coords.latitude, lon: pos.coords.longitude }),
        (err) => console.log("Silent location access failed:", err),
        { timeout: 10000, maximumAge: 0 }
      );
    }
  }, [observerLocation]);

  /* BODY CLASS */
  useEffect(() => {
    document.body.classList.toggle("sky-mode", viewMode === "sky");
  }, [viewMode]);

  /* LOAD SATS */
  useEffect(() => {
    fetch(`${API_BASE}/api/tle/all`)
      .then((r) => {
        if (!r.ok) throw new Error("API response not ok");
        return r.json();
      })
      .then((data) => {
        setSatellites(data);
        setTotalSats(data.length);
        setApiError(null);
      })
      .catch((err) => {
         console.error("Failed to fetch TLEs:", err);
         setApiError("The central database is currently waking up from sleep (Render.com free tier spins down after 15 minutes of inactivity). Please wait about 50 seconds and then refresh the page!");
      });

    fetch(`${API_BASE}/api/stats`)
      .then(r => r.json())
      .then(data => {
        if (data.status === "ok") {
          setSatStats({ leo: data.leo, meo: data.meo, geo: data.geo });
        }
      })
      .catch(console.error);
  }, []);

  /* SEARCH */
  useEffect(() => {
    if (searchQuery.length < 2) {
      setSearchResults([]);
      return;
    }
    fetch(`${API_BASE}/search?name=${encodeURIComponent(searchQuery)}`)
      .then((r) => r.json())
      .then(setSearchResults);
  }, [searchQuery]);

  /* COUNTDOWN */
  useEffect(() => {
    if (!bestPass?.rise) return;
    const id = setInterval(() => {
      const diff = new Date(bestPass.rise) - Date.now();
      if (diff <= 0) {
        setCountdown("Now");
        clearInterval(id);
      } else {
        setCountdown(
          `${Math.floor(diff / 60000)}m ${Math.floor((diff % 60000) / 1000)}s`
        );
      }
    }, 1000);
    return () => clearInterval(id);
  }, [bestPass]);

  /* SIDEBAR CLOSE ON VIEW CHANGE */
  useEffect(() => setIsSidebarOpen(false), [viewMode]);

  /* FETCH PASSES */
  const getPasses = () => {
    if (!selectedSatellite) return;
    if (!navigator.geolocation) {
      setPassError("Geolocation not supported by his browser.");
      return;
    }
    setLoadingPasses(true);
    setPassError(null);
    setShowPassPanel(true);

    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const { latitude, longitude } = pos.coords;
        setObserverLocation({ lat: latitude, lon: longitude });

        fetch(
          `${API_BASE}/satellite/${selectedSatellite.norad}/passes?lat=${latitude}&lon=${longitude}`
        )
          .then((res) => {
            if (!res.ok) throw new Error("Failed to fetch passes");
            return res.json();
          })
          .then((data) => {
            setPasses(data.passes || []);
            setBestPass(data.best_pass || null);
            setLoadingPasses(false);
          })
          .catch((err) => {
            setPassError(err.message);
            setLoadingPasses(false);
          });
      },
      (err) => {
        setPassError("Location access denied. Please enable location permissions.");
        setLoadingPasses(false);
      },
      { timeout: 10000, maximumAge: 0 }
    );
  };

  return (
    <div className="app-root">
      {/* MOBILE HEADER */}
      <div className="mobile-header">
        <button className="mobile-menu-btn" onClick={() => setIsSidebarOpen(v => !v)}>☰</button>
        <div className="mobile-title-flex">
          <img src="/premium-logo.png" alt="logo" className="app-logo-mobile" />
          <div className="mobile-title">Satellite Tracker</div>
        </div>
        <button className="mobile-home-btn" onClick={() => {
            window.dispatchEvent(new CustomEvent('reset-camera'));
            setSelectedSatellite(null);
            setHighlightedNorad(null);
            setTrackingNorad(null);
        }}>
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"></path><polyline points="9 22 9 12 15 12 15 22"></polyline></svg>
        </button>
      </div>

      {/* VIEW TOGGLE */}
      <div className="view-toggle">
        <button className={viewMode === "globe" ? "active" : ""} onClick={() => setViewMode("globe")}>
          <svg width="16" height="16" style={{marginRight: '6px', verticalAlign: 'text-bottom'}} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"></circle><line x1="2" y1="12" x2="22" y2="12"></line><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"></path></svg>
          Globe
        </button>
        <button className={viewMode === "sky" || isTransitioningToSky ? "active" : ""} onClick={() => {
          if (viewMode === "sky" || isTransitioningToSky) return;
          setIsTransitioningToSky(true);
          
          if (!observerLocation && navigator.geolocation) {
             navigator.geolocation.getCurrentPosition(
               (pos) => {
                 setObserverLocation({ lat: pos.coords.latitude, lon: pos.coords.longitude });
                 finishSkyTransition();
               },
               () => finishSkyTransition() // Still transition even if failed (shows empty sky but UI works)
             );
          } else {
             finishSkyTransition();
          }

          function finishSkyTransition() {
             setTimeout(() => {
               setViewMode("sky");
               setIsTransitioningToSky(false);
             }, 300);
          }

        }} disabled={isTransitioningToSky}>🌌 Sky</button>
      </div>

      {/* LEFT SIDEBAR */}
      <div className={`sidebar ${isSidebarOpen ? "mobile-open" : ""}`}>
        <div className="sidebar-brand">
          <img src="/premium-logo.png" alt="logo" className="app-logo-sidebar" />
          <h2>Satellite Tracker</h2>
          {isMobile && (
            <button className="sidebar-close-btn" onClick={() => setIsSidebarOpen(false)}>✕</button>
          )}
        </div>
        <input
          className="search-input"
          placeholder="Search satellite (name or NORAD)"
          value={searchQuery}
          onChange={e => {
            setSearchQuery(e.target.value);
            setSearchIndex(-1);
          }}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown") {
              setSearchIndex((prev) => Math.min(prev + 1, searchResults.length - 1));
              e.preventDefault();
            } else if (e.key === "ArrowUp") {
              setSearchIndex((prev) => Math.max(prev - 1, -1));
              e.preventDefault();
            } else if (e.key === "Enter") {
              const target = searchIndex >= 0 ? searchResults[searchIndex] : searchResults[0];
              if (target) {
                setHighlightedNorad(target.norad);
                setSelectedSatellite(target);
                setSearchResults([]);
                setSearchQuery("");
                if (isMobile) setIsSidebarOpen(false);
              }
              e.preventDefault();
            } else if (e.key === "Escape") {
              setSearchResults([]);
              setSearchQuery("");
            }
          }}
        />

        {searchResults.map((s, idx) => (
          <div key={s.norad} className={`search-item ${idx === searchIndex ? "selected" : ""}`} onClick={() => {
            setHighlightedNorad(s.norad);
            setSelectedSatellite(s);
            setSearchResults([]);
            setSearchQuery("");
            if (isMobile) setIsSidebarOpen(false);
          }}>
            {s.name.split(new RegExp(`(${searchQuery})`, "gi")).map((part, i) =>
              part.toLowerCase() === searchQuery.toLowerCase() ? (
                <strong key={i} style={{ color: "#ffd700" }}>{part}</strong>
              ) : (
                part
              )
            )}{" "}
            ({s.norad})
          </div>
        ))}

        <div className="sat-count">
          <strong>Database:</strong> {totalSats} sats<br />
          <strong>LEO:</strong> {satStats.leo} | <strong>MEO:</strong> {satStats.meo} | <strong>GEO:</strong> {satStats.geo}<br />
          <strong>Visible:</strong> {visibleSats} rendered
        </div>

        {selectedSatellite && !isMobile && (
          <div style={{ marginTop: "16px", marginBottom: "16px", background: "rgba(0,0,0,0.3)", borderRadius: "8px", padding: "12px", border: "1px solid rgba(255,255,255,0.1)" }}>
            <h4>Satellite Info</h4>
            <div className="sat-info">
              <strong>{selectedSatellite.name}</strong>
              <div>NORAD: {selectedSatellite.norad}</div>
              <div>Orbit: {selectedSatellite.orbit}</div>
              <div>Category: {selectedSatellite.category}</div>
              <div style={{ opacity: 0.8 }}>Confidence: {selectedSatellite.categoryConfidence ?? "N/A"}</div>
              <div>Country: {selectedSatellite.country}</div>

              <hr style={{ borderColor: "rgba(255,255,255,0.15)", margin: "12px 0" }} />

              <div>Altitude: {selectedSatellite.altitudeKm} km</div>
              <div>Velocity: {selectedSatellite.velocityKmS} km/s</div>
              {selectedSatellite.inclinationDeg && <div>Inclination: {selectedSatellite.inclinationDeg}°</div>}
              {selectedSatellite.periodMin && <div>Period: {selectedSatellite.periodMin} min</div>}
              {selectedSatellite.launchYear && <div>Launch Year: {selectedSatellite.launchYear}</div>}
              <div>Operator: {selectedSatellite.operator ?? "Unknown"}</div>

              <hr style={{ borderColor: "rgba(255,255,255,0.15)", margin: "12px 0" }} />

              <div>Local Time: {selectedSatellite.localTime}</div>

              <div style={{ display: 'flex', gap: '8px' }}>
                <button className="primary-btn map-cmd-btn" onClick={getPasses} style={{ flex: 1 }}>
                  Passes
                </button>
                <button
                  className="secondary-btn"
                  onClick={() => setTrackingNorad(prev => prev === selectedSatellite.norad ? null : selectedSatellite.norad)}
                  style={{ flex: 1, margin: '10px 0 0', backgroundColor: trackingNorad === selectedSatellite.norad ? '#ff4d4d' : 'rgba(255, 255, 255, 0.1)' }}
                >
                  {trackingNorad === selectedSatellite.norad ? "Stop Tracking" : "Track Orbit"}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* TIME SLIDER PANEL (Integrated for Desktop) */}
        {!isMobile && (
          <div className="time-slider-integrated">
            <label style={{ fontWeight: 600 }}>Time Travel: {timeOffsetHours > 0 ? `+${timeOffsetHours}` : timeOffsetHours}h</label>
            <input 
              type="range" 
              min="-12" max="12" step="0.5" 
              value={timeOffsetHours}
              onChange={(e) => setTimeOffsetHours(parseFloat(e.target.value))}
              style={{ width: "100%", margin: "8px 0" }}
            />
            {timeOffsetHours !== 0 && (
               <button className="secondary-btn" onClick={() => setTimeOffsetHours(0)}>Reset to live</button>
            )}
          </div>
        )}

        <h4>Orbit</h4>
        {Object.keys(orbitFilters).map(o => (
          <label key={o}>
            <input type="checkbox" checked={orbitFilters[o]} onChange={() => setOrbitFilters(p => ({ ...p, [o]: !p[o] }))} /> {o}
          </label>
        ))}

        <h4>Category</h4>
        {Object.keys(categoryFilters).map(c => (
          <label key={c}>
            <input type="checkbox" checked={categoryFilters[c]} onChange={() => setCategoryFilters(p => ({ ...p, [c]: !p[c] }))} /> {c}
          </label>
        ))}

        <div style={{ marginTop: '20px', marginBottom: '30px' }}>
          <h4>Max Rendered: {maxRender}</h4>
          <input 
            type="range" 
            min="1000" 
            max="15000" 
            step="500" 
            value={maxRender} 
            onChange={(e) => setMaxRender(parseInt(e.target.value))} 
            style={{ width: "100%", accentColor: "#ff4d4d" }}
          />
          <div style={{ fontSize: "11px", opacity: 0.7, marginTop: "4px" }}>
            Higher limits may cause 3D rendering lag on slower laptops and mobile devices.
          </div>
        </div>
      </div>

      {/* PASS PANEL — RESTORED */}
      {showPassPanel && (
        <div
          className="pass-panel"
          onTouchStart={(e) => touchStartY.current = e.touches[0].clientY}
          onTouchEnd={(e) => {
            if (e.changedTouches[0].clientY - touchStartY.current > 80) {
              setShowPassPanel(false);
            }
          }}
        >
          <button className="close-btn" onClick={() => setShowPassPanel(false)}>
            ×
          </button>
          {loadingPasses ? (
            <div className="loading-spinner">Calculating orbits...</div>
          ) : passError ? (
            <div className="error-msg">{passError}</div>
          ) : passes.length === 0 ? (
            <div className="no-passes">No visible passes in next 24h</div>
          ) : (
            <>
              {bestPass && (
                <div className="best-pass-card">
                  <h4>⭐ Best pass today</h4>
                  <div className="pass-details">
                    <div>
                      🌎 Rise: {new Date(bestPass.rise).toLocaleTimeString()}
                    </div>
                    <div>
                      ⭐ Max: {new Date(bestPass.max).toLocaleTimeString()}
                    </div>
                    <div>
                      🔮 Set: {new Date(bestPass.set).toLocaleTimeString()}
                    </div>
                    <div className="pass-meta">
                      Peak elevation: {bestPass.max_elevation}°<br />
                      Compass: <strong>{bestPass.direction}</strong> ({bestPass.azimuth_deg}°)<br />
                      Visibility: <strong>{bestPass.visibility.replace("_", " ")}</strong><br />
                      {bestPass.magnitude && <>Magnitude (est): {bestPass.magnitude}<br /></>}
                      Confidence: {"★".repeat(bestPass.quality)}
                      {"☆".repeat(5 - bestPass.quality)}<br />
                      <small className="hint-text">{bestPass.visibility_hint}</small>
                    </div>
                  </div>
                  {countdown && countdown !== "Now" && (
                    <div className="countdown-pill">
                      ⏳ Starts in: <strong>{countdown}</strong>
                    </div>
                  )}
                </div>
              )}

              <button
                className="secondary-btn"
                onClick={() => setShowAllPasses(!showAllPasses)}
              >
                {showAllPasses ? "Hide other passes" : "Show all passes (24h)"}
              </button>

              {showAllPasses && (
                <div className="other-passes">
                  {passes
                    .filter((p) => p !== bestPass)
                    .map((p, i) => (
                      <div key={i} className="pass-card-mini">
                        <div>
                          Rise: {new Date(p.rise).toLocaleTimeString()}
                        </div>
                        <div>Max: {new Date(p.max).toLocaleTimeString()}</div>
                        <div>Set: {new Date(p.set).toLocaleTimeString()}</div>
                      </div>
                    ))}
                </div>
              )}
            </>
          )}
        </div>
      )}

      {/* MOBILE FLOATING TIME SLIDER */}
      {isMobile && (
         <div className="time-slider-panel mobile-time-slider">
            <label style={{ fontWeight: 600 }}>Time Travel: {timeOffsetHours > 0 ? `+${timeOffsetHours}` : timeOffsetHours}h</label>
            <input 
              type="range" 
              min="-12" max="12" step="0.5" 
              value={timeOffsetHours}
              onChange={(e) => setTimeOffsetHours(parseFloat(e.target.value))}
            />
            {timeOffsetHours !== 0 && (
              <button className="reset-time-btn" onClick={() => setTimeOffsetHours(0)}>Live</button>
            )}
         </div>
      )}

      {/* MOBILE SATELLITE INFO CARD */}
      {isMobile && selectedSatellite && !showPassPanel && (
        <div className="mobile-sat-info-card">
          <div className="mobile-sat-header">
            <strong>{selectedSatellite.name}</strong>
            <button className="mobile-sat-close-btn" onClick={() => setSelectedSatellite(null)}>✕</button>
          </div>
          <div className="mobile-sat-details" style={{ maxHeight: "22vh", overflowY: "auto", paddingRight: "4px" }}>
            <div className="row"><span>NORAD:</span> <span>{selectedSatellite.norad}</span></div>
            <div className="row"><span>Orbit:</span> <span>{selectedSatellite.orbit}</span></div>
            <div className="row"><span>Category:</span> <span style={{textAlign: "right", maxWidth: "60%"}}>{selectedSatellite.category}</span></div>
            <div className="row"><span>Confidence:</span> <span>{selectedSatellite.categoryConfidence ?? "N/A"}</span></div>
            <div className="row"><span>Country:</span> <span>{selectedSatellite.country}</span></div>
            
            <hr style={{ borderColor: "rgba(255,255,255,0.15)", margin: "8px 0" }} />
            
            <div className="row"><span>Altitude:</span> <span>{selectedSatellite.altitudeKm} km</span></div>
            <div className="row"><span>Velocity:</span> <span>{selectedSatellite.velocityKmS} km/s</span></div>
            {selectedSatellite.inclinationDeg && <div className="row"><span>Inclination:</span> <span>{selectedSatellite.inclinationDeg}°</span></div>}
            {selectedSatellite.periodMin && <div className="row"><span>Period:</span> <span>{selectedSatellite.periodMin} min</span></div>}
            {selectedSatellite.launchYear && <div className="row"><span>Launch Year:</span> <span>{selectedSatellite.launchYear}</span></div>}
            <div className="row"><span>Operator:</span> <span style={{textAlign: "right", maxWidth: "60%"}}>{selectedSatellite.operator ?? "Unknown"}</span></div>
            
            <hr style={{ borderColor: "rgba(255,255,255,0.15)", margin: "8px 0" }} />
            
            <div className="row"><span>Local Time:</span> <span>{selectedSatellite.localTime}</span></div>
          </div>
          <div className="mobile-sat-actions">
            <button className="primary-btn" onClick={getPasses}>Passes</button>
            <button className="secondary-btn" onClick={() => {
                setTrackingNorad(prev => prev === selectedSatellite.norad ? null : selectedSatellite.norad);
                setIsSidebarOpen(false);
              }}
              style={{ margin: 0, backgroundColor: trackingNorad === selectedSatellite.norad ? '#ff4d4d' : 'rgba(255, 255, 255, 0.1)' }}
            >
              {trackingNorad === selectedSatellite.norad ? "Stop" : "Track Orbit"}
            </button>
          </div>
        </div>
      )}

      {/* CESIUM */}
      {viewMode === "globe" && (
        <CesiumMap
          satellites={(() => {
            const sliced = satellites.slice(0, maxRender);
            // Guarantee that if a user searches for a satellite, it GETS rendered!
            if (selectedSatellite && !sliced.some(s => s.norad === selectedSatellite.norad)) {
              return [...sliced, selectedSatellite];
            }
            return sliced;
          })()}
          orbitFilters={orbitFilters}
          categoryFilters={categoryFilters}
          highlightedNorad={highlightedNorad}
          bestPass={bestPass}
          observerLocation={observerLocation}
          onSelectSatellite={(sat) => {
            setSelectedSatellite(sat);
            setHighlightedNorad(sat.norad);
          }}
          onVisibleCountChange={setVisibleSats}
          isTransitioningToSky={isTransitioningToSky}
          trackingNorad={trackingNorad}
          setTrackingNorad={setTrackingNorad}
          timeOffsetHours={timeOffsetHours}
        />
      )}

      {/* SKY */}
      {(viewMode === "sky" || isTransitioningToSky) && observerLocation && (
        <div className="sky-view-root" style={{ opacity: viewMode === "sky" ? 1 : 0, transition: "opacity 0.3s ease-in-out", pointerEvents: viewMode === "sky" ? "auto" : "none" }}>
          <SkyView observerLocation={observerLocation} bestPass={bestPass} />
        </div>
      )}

      {/* FLOATING REPORT BUTTON */}
      <a 
        href="https://forms.gle/HooJCdeXVo3WubwS8" 
        target="_blank" 
        rel="noopener noreferrer" 
        className="floating-report-btn" 
      >
        🐛 Report Bug / Feedback
      </a>

      {apiError && (
        <div style={{
          position: "fixed",
          top: "50%",
          left: "50%",
          transform: "translate(-50%, -50%)",
          background: "rgba(220, 20, 60, 0.95)",
          color: "white",
          padding: "24px 32px",
          borderRadius: "12px",
          zIndex: 9999,
          textAlign: "center",
          boxShadow: "0 10px 40px rgba(0,0,0,0.6)",
          maxWidth: "80%",
          backdropFilter: "blur(10px)"
        }}>
          <h3 style={{ margin: "0 0 12px 0", fontSize: "20px" }}>⏳ Database Waking Up</h3>
          <p style={{ margin: 0, fontSize: "15px", lineHeight: "1.5" }}>{apiError}</p>
        </div>
      )}
    </div>
  );
}

