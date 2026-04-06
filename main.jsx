import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import LonestarBark from "./App.jsx";

createRoot(document.getElementById("root")).render(
  <StrictMode>
    <LonestarBark />
  </StrictMode>
);
