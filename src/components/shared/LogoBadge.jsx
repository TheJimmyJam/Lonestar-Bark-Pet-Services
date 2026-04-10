// ─── Logo Badge (inline SVG) ─────────────────────────────────────────────────
function LogoBadge({ size = 48 }) {
  return (
    <img
      src={LOGO_B64}
      alt="Lonestar Bark Co."
      width={size}
      height={size}
      style={{
        display: "block",
        flexShrink: 0,
        borderRadius: "50%",
        objectFit: "cover",
        width: size,
        height: size,
      }}
    />
  );
}


export default LogoBadge;
