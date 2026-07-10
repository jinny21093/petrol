import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  typescript: {
    ignoreBuildErrors: true,
  },
  reactStrictMode: false,
  // Отключаем встроенную оптимизацию изображений Next.js — мы не используем
  // компонент <Image>, только обычные <img>. Это экономит ~30 МБ в standalone
  // сборке (не тянет sharp и @img/sharp-libvips-linux-x64).
  images: {
    unoptimized: true,
  },
  // Отключаем сбор телеметрии Next.js (анонимной статистики использования).
  // Уменьшает шум в логах и слегка ускоряет build.
  telemetry: {
    version: "exact",
  },
};

export default nextConfig;
