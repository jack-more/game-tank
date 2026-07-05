import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import { installAudioUnlocker } from "./audio";
import { registerServiceWorker } from "./pwa";
import "./styles.css";

installAudioUnlocker();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

registerServiceWorker();
