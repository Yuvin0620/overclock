@echo off
cd /d "%~dp0"
if not exist node_modules call npm install
call npm run build
echo.
echo 빌드 완료! index.html 을 더블클릭해서 열어보세요.
pause
