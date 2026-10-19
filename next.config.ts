import type { NextConfig } from "next";
import path from "node:path";

const securityHeaders = [
  {
    key: "Content-Security-Policy",
    value: [
      "default-src 'self'",
      "base-uri 'self'",
      "form-action 'self'",
      "frame-ancestors 'self'",
      "img-src 'self' data: blob: http: https:",
      "font-src 'self' data: https:",
      "style-src 'self' 'unsafe-inline' https:",
      // 'unsafe-eval' só no modo dev do Next (source maps, HMR). Em produção fica só
      // 'wasm-unsafe-eval': a cena compila WebAssembly (decodificadores dos modelos 3D),
      // sem liberar eval de JavaScript.
      ...(process.env.NODE_ENV !== "production"
        ? ["script-src 'self' 'unsafe-inline' 'unsafe-eval' 'wasm-unsafe-eval' blob:"]
        : ["script-src 'self' 'unsafe-inline' 'wasm-unsafe-eval' blob:"]),
      // O único destino é o adaptador local do Agentário (e o HMR do próprio servidor em dev).
      "connect-src 'self' ws://localhost:* ws://127.0.0.1:* http://localhost:* http://127.0.0.1:*",
      "media-src 'self' blob: data: http: https:",
      "worker-src 'self' blob:",
      "object-src 'none'",
      "upgrade-insecure-requests",
    ].join("; "),
  },
  {
    key: "Referrer-Policy",
    value: "strict-origin-when-cross-origin",
  },
  {
    key: "X-Content-Type-Options",
    value: "nosniff",
  },
  {
    key: "X-Frame-Options",
    value: "SAMEORIGIN",
  },
  {
    key: "Permissions-Policy",
    value: "camera=(), microphone=(self), geolocation=(), browsing-topics=()",
  },
  {
    key: "Cross-Origin-Resource-Policy",
    value: "same-origin",
  },
];

if (process.env.NODE_ENV === "production") {
  securityHeaders.push({
    key: "Strict-Transport-Security",
    value: "max-age=31536000; includeSubDomains",
  });
}

const nextConfig: NextConfig = {
  turbopack: {
    root: path.resolve(__dirname),
  },
  async headers() {
    return [
      {
        source: "/:path*",
        headers: securityHeaders,
      },
    ];
  },
};

export default nextConfig;
