import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";

import * as Cesium from "cesium";
import "cesium/Build/Cesium/Widgets/widgets.css";

// Cesium config
Cesium.Ion.defaultAccessToken = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJqdGkiOiJlMGEwYTA1Yi1lNWZkLTQ4ZWUtOWQ4NS0wMTA2NjMzYTgyOTMiLCJpZCI6MzY3MTM3LCJpYXQiOjE3NjUwMDI4NDF9.tEFUeQFRN-0tYDBTKocX1vSVSxU8oLKWVJJZD8IsMFg";
window.CESIUM_BASE_URL = "/cesium";

ReactDOM.createRoot(document.getElementById("root")).render(
  <App />
);
