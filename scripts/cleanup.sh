#!/bin/bash

# Cleanup script for TKN Distribute project
# Removes build artifacts, logs, and other unnecessary files

echo "🧹 Cleaning up TKN Distribute project..."

# Remove build artifacts
echo "📦 Removing build artifacts..."
rm -rf dist/
rm -rf build/

# Remove logs
echo "📝 Removing log files..."
rm -f *.log
rm -f logs/*.log 2>/dev/null || true

# Remove node modules (optional - uncomment if needed)
# echo "🗑️  Removing node_modules..."
# rm -rf node_modules/

# Remove TypeScript cache
echo "🔧 Removing TypeScript cache..."
rm -f *.tsbuildinfo

# Remove npm cache (optional)
# echo "🗑️  Clearing npm cache..."
# npm cache clean --force

# Remove empty directories
echo "📁 Removing empty directories..."
find . -type d -empty -delete 2>/dev/null || true

echo "✅ Cleanup complete!"
echo ""
echo "To rebuild the project:"
echo "  npm install"
echo "  npm run build"
echo ""
echo "To start development:"
echo "  npm run dev" 