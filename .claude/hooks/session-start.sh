#!/bin/bash
set -e

echo "=== AudioSpec_Analyzer Session Start ==="
echo "Node: $(node --version)"
echo "npm:  $(npm --version)"

if [ -f "package.json" ]; then
  echo "Installing dependencies..."
  npm install --silent
  echo "Dependencies ready."
fi

if [ ! -f ".env" ]; then
  echo "WARNING: .env not found. Copy .env.example to .env and set GEMINI_API_KEY."
fi

echo "=== Ready ==="
