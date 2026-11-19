@echo off
chcp 65001 >nul
title Publicar Argon Boletos XML no GitHub
echo ========================================================
echo   PUBLICADOR SEGURO - ARGON BOLETOS ^& XML (GITHUB)
echo ========================================================
echo.

if not exist ".gitignore" (
    echo ERRO: arquivo .gitignore nao encontrado! Abortando para evitar envio de arquivos sensiveis.
    pause
    exit /b 1
)

if not exist ".git" (
    git init
    git branch -M main
)

echo Arquivos que serao preparados para envio:
git status --short
echo.
set /p CONFIRM="Confirma o commit e envio para repositorio PRIVADO no GitHub? (S/N): "
if /i not "%CONFIRM%"=="S" (
    echo Operacao cancelada pelo usuario.
    pause
    exit /b 0
)

git add .
git commit -m "feat: Argon Boletos XML v1.5.0 (offline + PWA + Electron)"

where gh >nul 2>nul
if %ERRORLEVEL% EQU 0 (
    gh repo create argon-boletos-xml --private --source=. --remote=origin --push --description "Argon — Sistema offline de automacao de boletos em XML (NF-e)"
    echo.
    echo Repositorio privado publicado com sucesso!
    pause
    exit /b 0
)

set /p REPO_URL="Cole a URL do seu repositorio GitHub privado (ex: https://github.com/SEU-USUARIO/argon-boletos-xml.git): "
git remote remove origin >nul 2>nul
git remote add origin %REPO_URL%
git push -u origin main
echo.
echo Arquivos enviados com sucesso!
pause
