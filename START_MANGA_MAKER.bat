@echo off
echo Starting Manga Generator...
echo.

:: Check if node_modules exists, if not run npm install
if not exist "node_modules\" (
    echo node_modules not found. Installing dependencies...
    call npm install
)

:: Run the launch script
call npm run launch

pause
