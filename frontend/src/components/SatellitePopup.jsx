// src/components/SatellitePopup.jsx
import React from "react";

export default function SatellitePopup({ info, onClose }) {
  if (!info) return null;

  const boxStyle = {
    position: "absolute",
    left: 20,
    top: 20,
    width: 300,
    padding: 16,
    background: "rgba(0,0,0,0.78)",
    color: "white",
    borderRadius: 10,
    zIndex: 20000,
    border: "1px solid rgba(255,255,255,0.15)",
    fontSize: 14,
    backdropFilter: "blur(6px)",
  };

  return (
    <div style={boxStyle}>
      <div
        style={{
          fontSize: 17,
          marginBottom: 10,
          fontWeight: "bold",
          letterSpacing: 0.3,
        }}
      >
        {info.name}
      </div>

      <div><b>NORAD ID:</b> {info.norad}</div>
      <div><b>Orbit:</b> {info.orbit}</div>
      <div><b>Category:</b> {info.category}</div>

      <hr style={{ borderColor: "#444", margin: "10px 0" }} />

      <div><b>Country:</b> {info.country ?? "Unknown"}</div>
      <div style={{ opacity: 0.7 }}>
        <b>Confidence:</b> {info.countryConfidence ?? "classified"}
      </div>

      <hr style={{ borderColor: "#444", margin: "10px 0" }} />

      <div><b>Latitude:</b> {info.latitude}</div>
      <div><b>Longitude:</b> {info.longitude}</div>
      <div><b>Altitude:</b> {info.altitudeKm} km</div>
      <div><b>Velocity:</b> {info.velocityKmS} km/s</div>

      <div style={{ marginTop: 6, opacity: 0.85 }}>
        <b>Local Time:</b> {info.localTime}
      </div>

      <button
        onClick={onClose}
        style={{
          marginTop: 12,
          padding: "6px 12px",
          background: "#aa3333",
          border: "none",
          borderRadius: 6,
          color: "white",
          cursor: "pointer",
        }}
      >
        Close
      </button>
    </div>
  );
}
