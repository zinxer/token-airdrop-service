#!/bin/bash

# Acme Distribution Backend Setup Script
echo "🚀 Setting up Acme Distribution Backend..."

# Check for required tools
check_requirements() {
    echo "🔍 Checking requirements..."
    
    if ! command -v node &> /dev/null; then
        echo "❌ Node.js is not installed. Please install Node.js first."
        exit 1
    fi
    
    if ! command -v npm &> /dev/null; then
        echo "❌ npm is not installed. Please install npm first."
        exit 1
    fi
    
    echo "✅ Requirements check passed"
}

# Install dependencies if node_modules doesn't exist
install_dependencies() {
    if [ ! -d "node_modules" ]; then
        echo "📦 Installing dependencies..."
        npm install
    else
        echo "✅ Dependencies already installed"
    fi
}

# Check if .env file exists
setup_environment() {
    if [ ! -f .env ]; then
        echo "📋 Creating .env file from template..."
        cp env.example .env
        echo "⚠️  Please edit .env file with your actual configuration values!"
        echo "   Required values:"
        echo "   - ALCHEMY_API_KEY"
        echo "   - DISTRIBUTION_WALLET_PRIVATE_KEY"
        echo "   - DATABASE_URL"
        echo "   - TOKEN_ADDRESS"
    else
        echo "✅ .env file already exists"
    fi
}

# Generate Prisma client
setup_prisma() {
    echo "🔧 Generating Prisma client..."
    npx prisma generate
    
    # Check if database is accessible
    echo "🔍 Checking database connection..."
    if npx prisma db push --preview-feature 2>/dev/null; then
        echo "✅ Database connected successfully"
        
        # Run migrations
        echo "🗃️  Running database migrations..."
        npx prisma migrate dev --name init
        
        echo "✅ Database setup complete"
    else
        echo "❌ Database connection failed"
        echo "Please ensure your DATABASE_URL in .env is correct and the database is running"
        echo "Example DATABASE_URL: mysql://user:password@localhost:3306/token_airdrop"
        exit 1
    fi
}

# Build the project
build_project() {
    echo "🔨 Building project..."
    if npm run build; then
        echo "✅ Build successful"
    else
        echo "❌ Build failed. Please check for TypeScript errors."
        exit 1
    fi
}

# Main execution
main() {
    check_requirements
    install_dependencies
    setup_environment
    setup_prisma
    build_project
    
    echo "🎉 Setup complete!"
    echo ""
    echo "📝 Next steps:"
    echo "1. Edit .env file with your actual configuration"
    echo "2. Configure your MySQL database"
    echo "3. Run 'npm run dev' to start development server"
    echo ""
    echo "📚 Available commands:"
    echo "  npm run dev      - Start development server"
    echo "  npm run build    - Build production bundle"
    echo "  npm run start    - Start production server"
    echo "  npm run prisma:studio - Open Prisma Studio"
    echo "  npm run prisma:migrate - Run database migrations"
    echo ""
    echo "🔧 Troubleshooting:"
    echo "  - If database connection fails, check your DATABASE_URL"
    echo "  - If build fails, check for TypeScript errors"
    echo "  - If Prisma fails, try 'npx prisma generate' manually"
}

# Run main function
main 