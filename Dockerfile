# Use the Puppeteer base image
FROM ghcr.io/puppeteer/puppeteer:22.9.0

# Set environment variables to skip downloading Chromium and set the executable path
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true \
    PUPPETEER_EXECUTABLE_PATH=/usr/bin/google-chrome-stable

# Set the working directory
WORKDIR /usr/src/app

# Copy package.json and package-lock.json to the working directory
COPY package*.json ./

# Install dependencies using npm ci
RUN npm install

# Copy the rest of the application code to the working directory
COPY . .

# Command to run the application
CMD [ "node", "server.js" ]
