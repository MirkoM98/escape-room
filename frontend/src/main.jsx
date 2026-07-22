import React from "react";
import { createRoot } from "react-dom/client";
import EscapeRoom from "./EscapeRoom.jsx";
import "./index.css";

createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <EscapeRoom />
  </React.StrictMode>
);
