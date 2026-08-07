"use strict";

const esbuild = require("esbuild");
const path = require("node:path");

const outfile = path.join(__dirname, "bundle.js");

esbuild
  .build({
    entryPoints: [path.join(__dirname, "src", "index.ts")],
    bundle: true,
    platform: "node",
    target: "node22",
    format: "cjs",
    outfile,
    minify: true,
    sourcemap: false,
    legalComments: "none",
    logLevel: "info",
  })
  .then(() => {
    console.log(`Built ${outfile}`);
  })
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
