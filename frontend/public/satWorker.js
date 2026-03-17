/* satWorker.js
   MUST live in: frontend/public/satWorker.js
   MUST be plain JS (no import / export / JSX)
*/

self.onmessage = async (event) => {
  const { url } = event.data;

  try {
    const response = await fetch(url);

    if (!response.ok) {
      self.postMessage({
        error: `HTTP ${response.status} while fetching satellites`
      });
      return;
    }

    const data = await response.json();

    if (!Array.isArray(data)) {
      self.postMessage({
        error: "Satellite data is not an array"
      });
      return;
    }

    // Preallocate buffer (lon, lat, height)
    const buffer = new Float64Array(data.length * 3);
    let index = 0;

    for (let i = 0; i < data.length; i++) {
      const sat = data[i];
      const pos = sat.position;

      if (
        !pos ||
        typeof pos.latitude !== "number" ||
        typeof pos.longitude !== "number" ||
        typeof pos.altitude_km !== "number"
      ) {
        continue;
      }

      buffer[index++] = pos.longitude;          // degrees
      buffer[index++] = pos.latitude;           // degrees
      buffer[index++] = pos.altitude_km * 1000; // meters
    }

    // Transfer buffer to main thread (zero-copy)
    self.postMessage(
      {
        positions: buffer,
        count: index / 3
      },
      [buffer.buffer]
    );

  } catch (err) {
    self.postMessage({
      error: err.message || "Worker failed"
    });
  }
};
