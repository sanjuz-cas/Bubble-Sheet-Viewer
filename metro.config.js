const { getDefaultConfig } = require("expo/metro-config");

const config = getDefaultConfig(__dirname);

// Exclude Replit system directories from Metro watching.
// These contain transient files that disappear mid-watch and crash Metro.
config.resolver.blockList = [
  /\/\.local\/.*/,
  /\/\.agents\/.*/,
];

module.exports = config;
