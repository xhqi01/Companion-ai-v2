/* ============================================================
   Companion 设计系统 — 奶油纸底 + 莫兰迪低饱和 + 衬线标题
   温暖、亲密，像一本私人日记
   ============================================================ */
export const S = {
  paper: "#F4F0E7", paper2: "#EFEAE0", card: "#FBF8F2",
  ink: "#33302A", inkSoft: "#6E675C", inkFaint: "#A69E90",
  line: "#E2DBCD", lineSoft: "#EAE4D8",
  clay: "#B0785C", claySoft: "rgba(176,120,92,.10)", clayLine: "rgba(176,120,92,.28)", clayHover: "#9C6A50",
  mist: "#7E8C89", sage: "#97A088", dust: "#C9B79C", rose: "#B08A86",
  shadow: "0 1px 2px rgba(51,48,42,.04), 0 8px 24px rgba(51,48,42,.05)",
};
export const serif = `"Fraunces", "Noto Serif SC", Georgia, serif`;
export const sans = `"Inter", "Noto Sans SC", system-ui, sans-serif`;

// 根据名字生成头像渐变（稳定映射）
export function avatarGradient(name) {
  const palettes = [
    ["#C9B79C", "#B0785C"], // clay
    ["#A9B3AC", "#7E8C89"], // mist
    ["#C4A9A6", "#B08A86"], // rose
    ["#AEB5A0", "#97A088"], // sage
    ["#C7B8A0", "#B39B76"], // sand
  ];
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
  const [a, b] = palettes[h % palettes.length];
  return `radial-gradient(circle at 35% 30%, ${a}, ${b})`;
}
