#!/usr/bin/env bash
set -euo pipefail

echo "========================================================"
echo "  PUBLICADOR SEGURO - ARGON BOLETOS & XML (GITHUB)"
echo "========================================================"

if [ ! -f ".gitignore" ]; then
  echo "ERRO: arquivo .gitignore não encontrado. Abortando para evitar envio de backups ou arquivos sensíveis."
  exit 1
fi

if [ ! -d ".git" ]; then
  git init
  git branch -M main
fi

echo "Arquivos que serão incluídos:"
git status --short
echo ""
read -r -p "Confirma o commit e envio para repositório PRIVADO no GitHub? [s/N]: " CONFIRM
if [[ ! "$CONFIRM" =~ ^[sS]$ ]]; then
  echo "Operação cancelada."
  exit 0
fi

git add .
git commit -m "feat: Argon Boletos XML v1.5.0 (offline + PWA + Electron)" || true

if command -v gh >/dev/null 2>&1; then
  gh repo create argon-boletos-xml --private --source=. --remote=origin --push     --description "Argon — Sistema offline de automação de boletos em XML (NF-e)"
  echo "Repositório privado publicado com sucesso!"
else
  read -r -p "Cole a URL do seu repositório GitHub privado: " REPO_URL
  git remote remove origin 2>/dev/null || true
  git remote add origin "$REPO_URL"
  git push -u origin main
  echo "Arquivos enviados com sucesso!"
fi
