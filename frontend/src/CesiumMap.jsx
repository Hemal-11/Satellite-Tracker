import { useEffect, useRef } from "react";
import * as Cesium from "cesium";
import "cesium/Build/Cesium/Widgets/widgets.css";
import { buildTerminator } from "./utils/terminator";
import * as satellite from "satellite.js";

const ISS_NORAD = 25544;
const API_BASE = "";

/*
  CesiumMap.jsx

  Features INCLUDED (unchanged):
  - Cesium globe
  - Satellite rendering
  - Orbit/category filters
  - Search + highlight + flyTo
  - Pass path rendering
  - Observer marker + direction arrow
  - Click → sidebar info
  - Terminator (day/night line)
  - Hover tooltip
  - ISS emphasis

  FIXES (ADDITIVE, SAFE):
  - Single, deterministic Home button reset
  - Unified default camera preset
  - Mobile/iOS-safe camera behavior
*/

export default function CesiumMap({
  satellites,
  orbitFilters,
  categoryFilters,
  highlightedNorad,
  trackingNorad,
  setTrackingNorad,
  bestPass,
  observerLocation,
  onSelectSatellite,
  onVisibleCountChange,
  timeOffsetHours = 0,
}) {
  const containerRef = useRef(null);
  const viewerRef = useRef(null);
  const dsRef = useRef(null);

  const entityMap = useRef(new Map());
  const highlightRef = useRef(null);
  const passPathRef = useRef(null);
  const prevSearchEntityRef = useRef(null);

  const observerEntityRef = useRef(null);
  const directionArrowRef = useRef(null);
  const highlightedRef = useRef(highlightedNorad);

  // Bonus Features Flags
  const ENABLE_NIGHT_LIGHTS = false; // Toggle to false to easily remove city lights

  useEffect(() => {
    highlightedRef.current = highlightedNorad;
  }, [highlightedNorad]);

  /* =============================
     CANONICAL CAMERA PRESET
     ============================= */
  const DEFAULT_CAMERA_VIEW = {
    destination: Cesium.Cartesian3.fromDegrees(0, 20, 28_000_000),
    orientation: {
      heading: Cesium.Math.toRadians(0),
      pitch: Cesium.Math.toRadians(-90),
      roll: 0,
    },
  };

  /* =============================
     INIT CESIUM
     ============================= */
  useEffect(() => {
    if (viewerRef.current) return;

    const viewer = new Cesium.Viewer(containerRef.current, {
      animation: false,
      timeline: false,
      baseLayerPicker: false,
      geocoder: false,
      sceneModePicker: false,
      navigationHelpButton: false,
      fullscreenButton: false,
      homeButton: true,
      infoBox: false,
      selectionIndicator: false,
    });

    /* ===== globe visuals ===== */
    viewer.scene.globe.enableLighting = true;
    viewer.scene.skyAtmosphere.show = true;
    viewer.scene.light = new Cesium.SunLight({ intensity: 1.4 });

    if (ENABLE_NIGHT_LIGHTS) {
      try {
        const blackMarble = viewer.imageryLayers.addImageryProvider(
          new Cesium.IonImageryProvider({ assetId: 3812 })
        );
        blackMarble.dayAlpha = 0.0;
      } catch (e) {
        console.warn("Could not load tracking night lights", e);
      }
    }

    /* ===== camera limits (mobile-safe) ===== */
    const c = viewer.scene.screenSpaceCameraController;
    c.minimumZoomDistance = 5_000_000;
    c.maximumZoomDistance = 90_000_000;
    c.enableCollisionDetection = true;

    /* ===== initial camera view ===== */
    viewer.camera.setView(DEFAULT_CAMERA_VIEW);

    /* ======================================================
       🏠 HOME BUTTON — FINAL, SINGLE SOURCE OF TRUTH
       ====================================================== */
    viewer.homeButton.viewModel.command.beforeExecute.addEventListener((e) => {
      e.cancel = true;

      viewer.camera.flyTo({
        destination: DEFAULT_CAMERA_VIEW.destination,
        orientation: DEFAULT_CAMERA_VIEW.orientation,
        duration: 1.6,
      });
    });

    const handleCustomReset = () => {
      viewer.camera.flyTo({
        destination: DEFAULT_CAMERA_VIEW.destination,
        orientation: DEFAULT_CAMERA_VIEW.orientation,
        duration: 1.6,
      });
    };
    window.addEventListener('reset-camera', handleCustomReset);



    /* ===== datasource ===== */
    const ds = new Cesium.CustomDataSource("satellites");
    viewer.dataSources.add(ds);

    viewerRef.current = viewer;
    dsRef.current = ds;

    /* =============================
       HOVER TOOLTIP
       ============================= */
    const tooltip = document.createElement("div");
    Object.assign(tooltip.style, {
      position: "absolute",
      padding: "6px 8px",
      background: "rgba(0,0,0,0.85)",
      color: "#fff",
      fontSize: "12px",
      borderRadius: "6px",
      pointerEvents: "none",
      display: "none",
      zIndex: 1000,
      whiteSpace: "nowrap",
    });
    viewer.container.appendChild(tooltip);

    let hoveredEntity = null;

    const handler = new Cesium.ScreenSpaceEventHandler(viewer.scene.canvas);
    handler.setInputAction((movement) => {
      const picked = viewer.scene.pick(movement.endPosition);

      if (hoveredEntity && (!picked || hoveredEntity !== picked.id)) {
        if (hoveredEntity.point && hoveredEntity.id !== ISS_NORAD && hoveredEntity.id !== highlightedRef.current) {
          hoveredEntity.point.pixelSize = 5.5;
          hoveredEntity.point.outlineColor = Cesium.Color.TRANSPARENT;
          hoveredEntity.point.outlineWidth = 0;
        }
        hoveredEntity = null;
      }

      if (picked?.id?.properties) {
        if (!hoveredEntity && picked.id.id !== ISS_NORAD && picked.id.id !== highlightedRef.current) {
          hoveredEntity = picked.id;
          if (hoveredEntity.point) {
            hoveredEntity.point.pixelSize = 8;
            hoveredEntity.point.outlineColor = Cesium.Color.WHITE;
            hoveredEntity.point.outlineWidth = 2;
          }
        }

        const p = picked.id.properties;
        tooltip.style.display = "block";
        tooltip.style.left = movement.endPosition.x + 12 + "px";
        tooltip.style.top = movement.endPosition.y + 12 + "px";
        // Build tooltip with safe DOM APIs — never use innerHTML with external data
        tooltip.textContent = "";

        const nameEl = document.createElement("strong");
        nameEl.textContent = picked.id.name;
        tooltip.appendChild(nameEl);

        const line1 = document.createElement("div");
        line1.textContent = `NORAD: ${picked.id.id}`;
        tooltip.appendChild(line1);

        const line2 = document.createElement("div");
        line2.textContent = `Orbit: ${p.orbit?.getValue() ?? "—"}`;
        tooltip.appendChild(line2);

        const line3 = document.createElement("div");
        line3.textContent = `Category: ${p.category?.getValue() ?? "unknown"}`;
        tooltip.appendChild(line3);
      } else {
        tooltip.style.display = "none";
      }
      viewer.scene.requestRender();
    }, Cesium.ScreenSpaceEventType.MOUSE_MOVE);

    return () => {
      handler.destroy();
      window.removeEventListener('reset-camera', handleCustomReset);
    };
  }, []);

  /* =============================
     ORBIT COLORS
     ============================= */
  function orbitColor(orbit) {
    if (orbit === "LEO") return Cesium.Color.YELLOW.withAlpha(0.85);
    if (orbit === "MEO") return Cesium.Color.CYAN.withAlpha(0.85);
    if (orbit === "GEO") return Cesium.Color.RED.withAlpha(0.85);
    return Cesium.Color.GRAY.withAlpha(0.3);
  }

  /* =============================
     LOAD SATELLITES
     ============================= */
  useEffect(() => {
    const ds = dsRef.current;
    if (!ds) return;

    ds.entities.removeAll();
    entityMap.current.clear();

    ds.entities.suspendEvents();

    satellites.forEach((sat) => {
      if (!sat.position?.latitude && (!sat.tle1 || !sat.tle2)) return;

      let satrec;
      try {
        if (sat.tle1 && sat.tle2) {
          satrec = satellite.twoline2satrec(sat.tle1, sat.tle2);
        }
      } catch (e) {}

      let initialPos = Cesium.Cartesian3.fromDegrees(0, 0, 0);
      if (sat.position?.latitude) {
        initialPos = Cesium.Cartesian3.fromDegrees(
          sat.position.longitude,
          sat.position.latitude,
          sat.position.altitude_km * 1000
        );
      }

      const norad = Number(sat.norad);
      const isISS = norad === ISS_NORAD;

      const positionProperty = new Cesium.CallbackProperty((time) => {
        if (!satrec) return initialPos;
        const jsDate = Cesium.JulianDate.toDate(time);
        try {
          const pv = satellite.propagate(satrec, jsDate);
          if (pv.position && typeof pv.position.x === "number") {
            const gmst = satellite.gstime(jsDate);
            const gd = satellite.eciToGeodetic(pv.position, gmst);
            const lon = Cesium.Math.toDegrees(gd.longitude);
            const lat = Cesium.Math.toDegrees(gd.latitude);
            const alt = gd.height * 1000;
            return Cesium.Cartesian3.fromDegrees(lon, lat, alt);
          }
        } catch (e) {}
        return initialPos;
      }, false);

      const entity = ds.entities.add({
        id: norad,
        name: sat.name,
        position: positionProperty,
        point: !isISS
          ? {
            pixelSize: 5.5,
            color: orbitColor(sat.orbit),
            scaleByDistance: new Cesium.NearFarScalar(2e6, 1.2, 7e7, 0.25),
            disableDepthTestDistance: 0,
          }
          : {
            pixelSize: 10,
            color: Cesium.Color.CYAN,
            outlineColor: Cesium.Color.WHITE,
            outlineWidth: 2,
            disableDepthTestDistance: Infinity,
          },
        label: isISS
          ? {
            text: "🛰️ ISS",
            font: "bold 16px sans-serif",
            fillColor: Cesium.Color.CYAN,
            outlineColor: Cesium.Color.BLACK,
            outlineWidth: 2,
            style: Cesium.LabelStyle.FILL_AND_OUTLINE,
            verticalOrigin: Cesium.VerticalOrigin.BOTTOM,
            pixelOffset: new Cesium.Cartesian2(0, -22),
            disableDepthTestDistance: Infinity,
          }
          : undefined,
        properties: {
          orbit: sat.orbit ?? "UNKNOWN",
          category: sat.category ?? "unknown",
          category_confidence: sat.category_confidence,
          country: sat.country,
          country_confidence: sat.country_confidence,
          velocity_kms: sat.velocity_kms,
          launch_year: sat.launch_year,
          inclination_deg: sat.inclination_deg,
          period_min: sat.period_min,
          operator: sat.operator,
        },
      });

      entityMap.current.set(norad, entity);
    });

    ds.entities.resumeEvents();
    viewerRef.current.scene.requestRender();
  }, [satellites]);

  /* =============================
     FILTERS
     ============================= */
  useEffect(() => {
    let visible = 0;
    const ds = dsRef.current;
    if (!ds) return;

    ds.entities.suspendEvents();

    entityMap.current.forEach((e) => {
      const orbit = e.properties.orbit.getValue();
      const category = e.properties.category.getValue();

      const show =
        orbitFilters[orbit] === true &&
        categoryFilters[category] === true;

      e.show = show;
      if (show) visible++;
    });

    ds.entities.resumeEvents();

    onVisibleCountChange?.(visible);
    viewerRef.current.scene.requestRender();
  }, [orbitFilters, categoryFilters]);

  /* =============================
     SEARCH → HIGHLIGHT + FLYTO
     ============================= */
  useEffect(() => {
    if (!highlightedNorad || !viewerRef.current) return;

    const viewer = viewerRef.current;
    const ds = dsRef.current;
    const target = entityMap.current.get(Number(highlightedNorad));
    if (!target) return;

    if (
      prevSearchEntityRef.current?.point &&
      prevSearchEntityRef.current.id !== ISS_NORAD
    ) {
      const prev = prevSearchEntityRef.current;
      prev.point.pixelSize = 5.5;
      prev.point.color = orbitColor(prev.properties.orbit.getValue());
    }

    if (target.point && target.id !== ISS_NORAD) {
      target.point.pixelSize = 9;
      target.point.color = Cesium.Color.MAGENTA;
    }

    // forcefully show target even if orbit/category filters are off
    target.show = true;

    prevSearchEntityRef.current = target;

    viewer.flyTo(target, {
      duration: 2.5,
      easingFunction: Cesium.EasingFunction.CUBIC_IN_OUT,
      offset: new Cesium.HeadingPitchRange(
        0,
        Cesium.Math.toRadians(-35),
        6_000_000
      ),
    });
  }, [highlightedNorad]);

  /* =============================
     TIME TRAVEL
     ============================= */
  useEffect(() => {
    if (!viewerRef.current) return;
    const currentRealTime = new Date();
    currentRealTime.setMinutes(currentRealTime.getMinutes() + timeOffsetHours * 60);
    viewerRef.current.clock.currentTime = Cesium.JulianDate.fromDate(currentRealTime);
  }, [timeOffsetHours]);

  /* =============================
     ORBIT TRAIL PATH
     ============================= */
  useEffect(() => {
    if (!highlightedNorad) return;

    const ds = dsRef.current;
    if (!ds) return;

    if (passPathRef.current) ds.entities.remove(passPathRef.current);

    const targetSat = satellites.find(s => s.norad === highlightedNorad);
    if (!targetSat || !targetSat.tle1 || !targetSat.tle2) return;

    try {
      const satrec = satellite.twoline2satrec(targetSat.tle1, targetSat.tle2);
      const positions = [];
      
      const realNow = new Date();
      // Generate -60 to +60 in 2 min increments
      for(let m = -60; m <= 60; m += 2) {
          const jsDate = new Date(realNow.getTime() + m * 60000);
          const pv = satellite.propagate(satrec, jsDate);
          if (pv.position && typeof pv.position.x === 'number') {
             const gmst = satellite.gstime(jsDate);
             const gd = satellite.eciToGeodetic(pv.position, gmst);
             const lon = Cesium.Math.toDegrees(gd.longitude);
             const lat = Cesium.Math.toDegrees(gd.latitude);
             const alt = gd.height * 1000;
             positions.push(Cesium.Cartesian3.fromDegrees(lon, lat, alt));
          }
      }

      if (positions.length > 2) {
        passPathRef.current = ds.entities.add({
          polyline: {
            positions,
            width: 3,
            material: Cesium.Color.ORANGE.withAlpha(0.85),
          },
        });
      }
    } catch(e) {}
  }, [highlightedNorad, satellites]);

  /* =============================
     TRACKING MODE & FOOTPRINT
     ============================= */
  useEffect(() => {
    if (!viewerRef.current) return;
    const viewer = viewerRef.current;

    let isFetching = true;
    let oldPosition = undefined;
    let footprintEntity = null;
    const entity = trackingNorad && entityMap.current.has(trackingNorad) ? entityMap.current.get(trackingNorad) : null;

    if (entity) {
      viewer.trackedEntity = entity;

      oldPosition = entity.position;

      // Draw footprint ellipse on a totally separate entity to avoid GeometryUpdater crashes
      footprintEntity = viewer.entities.add({
        position: new Cesium.CallbackProperty((time) => entity.position?.getValue(time), false),
        ellipse: {
          semiMinorAxis: new Cesium.CallbackProperty((time) => {
            const pos = entity.position?.getValue(time);
            if (!pos) return 1000000;
            const carto = Cesium.Cartographic.fromCartesian(pos);
            if (!carto) return 1000000;
            const h = carto.height;
            if (typeof h !== 'number' || isNaN(h)) return 1000000;
            return Math.sqrt(2 * 6371000 * h + h * h) * 0.45;
          }, false),
          semiMajorAxis: new Cesium.CallbackProperty((time) => {
            const pos = entity.position?.getValue(time);
            if (!pos) return 1000000;
            const carto = Cesium.Cartographic.fromCartesian(pos);
            if (!carto) return 1000000;
            const h = carto.height;
            if (typeof h !== 'number' || isNaN(h)) return 1000000;
            return Math.sqrt(2 * 6371000 * h + h * h) * 0.45;
          }, false),
          material: entity.point?.color?.getValue()?.withAlpha(0.25) || Cesium.Color.WHITE.withAlpha(0.2),
          outline: true,
          outlineColor: entity.point?.color?.getValue() || Cesium.Color.WHITE,
        }
      });

      return () => {
        viewer.trackedEntity = undefined;
        if (footprintEntity) {
          viewer.entities.remove(footprintEntity);
        }
      };
    } else {
      viewer.trackedEntity = undefined;
    }
  }, [trackingNorad]);

  /* =============================
     OBSERVER + DIRECTION
     ============================= */
  useEffect(() => {
    if (!observerLocation || !bestPass?.azimuth_deg) return;

    const ds = dsRef.current;
    if (!ds) return;

    if (observerEntityRef.current) ds.entities.remove(observerEntityRef.current);
    if (directionArrowRef.current) ds.entities.remove(directionArrowRef.current);

    const observerPos = Cesium.Cartesian3.fromDegrees(
      observerLocation.lon,
      observerLocation.lat,
      0
    );

    observerEntityRef.current = ds.entities.add({
      position: observerPos,
      point: {
        pixelSize: 8,
        color: Cesium.Color.LIME,
        outlineColor: Cesium.Color.BLACK,
        outlineWidth: 1,
      },
      label: {
        text: "You",
        font: "12px sans-serif",
        fillColor: Cesium.Color.LIME,
        verticalOrigin: Cesium.VerticalOrigin.TOP,
        pixelOffset: new Cesium.Cartesian2(0, 10),
      },
    });

    const bearingRad = Cesium.Math.toRadians(bestPass.azimuth_deg);
    const arrowEnd = Cesium.Cartesian3.fromDegrees(
      observerLocation.lon + Math.sin(bearingRad) * 2,
      observerLocation.lat + Math.cos(bearingRad) * 2,
      0
    );

    directionArrowRef.current = ds.entities.add({
      polyline: {
        positions: [observerPos, arrowEnd],
        width: 3,
        material: Cesium.Color.LIME.withAlpha(0.9),
      },
    });

    viewerRef.current.scene.requestRender();
  }, [observerLocation, bestPass]);

  /* =============================
     CLICK → SIDEBAR
     ============================= */
  useEffect(() => {
    if (!viewerRef.current) return;
    const viewer = viewerRef.current;
    const handler = new Cesium.ScreenSpaceEventHandler(viewer.scene.canvas);

    handler.setInputAction((click) => {
      const picked = viewer.scene.pick(click.position);
      if (!picked?.id) return;

      const p = picked.id.properties;
      const carto = Cesium.Cartographic.fromCartesian(
        picked.id.position.getValue(viewer.clock.currentTime)
      );

      const lon = Cesium.Math.toDegrees(carto.longitude);
      const localTime = new Date(
        Date.now() + lon * 4 * 60 * 1000
      ).toUTCString().replace("GMT", "");

      onSelectSatellite({
        norad: picked.id.id,
        name: picked.id.name,
        orbit: p.orbit.getValue(),
        category: p.category.getValue(),
        country: p.country.getValue(),
        categoryConfidence: p.category_confidence?.getValue(),
        launchYear: p.launch_year?.getValue(),
        inclinationDeg: p.inclination_deg?.getValue(),
        periodMin: p.period_min?.getValue(),
        operator: p.operator?.getValue(),
        latitude: Cesium.Math.toDegrees(carto.latitude).toFixed(4),
        longitude: lon.toFixed(4),
        altitudeKm: (carto.height / 1000).toFixed(2),
        velocityKmS: p.velocity_kms.getValue() ?? "—",
        localTime,
      });
    }, Cesium.ScreenSpaceEventType.LEFT_CLICK);

    return () => handler.destroy();
  }, [onSelectSatellite]);

  /* =============================
     TERMINATOR
     ============================= */
  useEffect(() => {
    const ds = dsRef.current;
    if (!ds) return;

    const term = ds.entities.add({
      polyline: {
        positions: buildTerminator(),
        width: 1,
        material: Cesium.Color.BLUE.withAlpha(0.2),
      },
    });

    const id = setInterval(() => {
      term.polyline.positions = buildTerminator();
      viewerRef.current.scene.requestRender();
    }, 60000);

    return () => {
      clearInterval(id);
      ds.entities.remove(term);
    };
  }, []);

  return <div ref={containerRef} className="cesium-container" />;
}
