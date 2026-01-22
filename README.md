# Manga Generator | Nano Banana Edition

A powerful, single-page application for generating manga panels using Google's Nano Banana (Gemini 1.5 Flash) and Nano Banana Pro (Gemini 1.5 Pro).

## Quick Start

1. **Install Dependencies**:
   ```bash
   npm install
   ```

2. **Configure API Key**:
   - Rename `.env.example` to `.env`.
   - Add your Google Gemini API Key.

3. **Run the Application**:
   ```bash
   npm start
   ```
   This will start the local backend server.

4. **Run the Frontend (Dev)**:
   In a separate terminal:
   ```bash
   npm run dev
   ```
   Open [http://localhost:5173](http://localhost:5173) in your browser.

## Features

- **Local Library**: Drop images into `characters/`, `locations/`, or `pages/` folders. The app automatically scans them.
- **Context Injection**: Select characters/locations from your library to pass them as visual references to the AI.
- **Panel Control**: Set the number of windows (panels) requested for a specific story segment.
- **Nano Banana Integration**: Switch between Flash (Nano Banana) and Pro (Nano Banana Pro) models.

## Structure
- `characters/`: Character sheets and reference images.
- `locations/`: Environment and scenery images.
- `pages/`: Your generated manga pages.
- `server.js`: Node.js server managing local files and Gemini API proxy.
