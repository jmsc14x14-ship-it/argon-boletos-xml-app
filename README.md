# Argon — Automação de Boletos em XML (NF-e)

Aplicativo local e 100% offline para gerenciar boletos extraídos de XML de NF-e, manter anexos salvos no navegador/Electron (XML, PDF do boleto, DANFE e comprovantes) e alertar sobre vencimentos em até 7 dias.

## Como usar

### 1. Abrir diretamente no navegador (ou servidor local / PWA)
- No Windows, execute `Iniciar_Argon_Windows.bat` (ou abra `index.html`).
- Em Linux/macOS, execute `./iniciar_argon.sh` (ou sirva a pasta via HTTP/HTTPS para ativar o Service Worker offline e instalação PWA).

### 2. Rodar como aplicativo Desktop (Electron)
```bash
npm install
npm start
```
Para gerar executáveis locais na pasta `dist/`:
```bash
npm run dist:win    # Windows
npm run dist:mac    # macOS
npm run dist:linux  # Linux
```

### 3. Recompilar o CSS estático (opcional)
O arquivo `style.css` já vai compilado no pacote. Caso altere classes Tailwind em `index.html` ou `app.js`, recompile com:
```bash
npm run build:css
```

### 4. Rodar os testes automatizados
```bash
npm test
```

## Formato de Backup v2 (com anexos)

O botão **Exportar Base (.json)** gera um arquivo no formato **v2**:
```json
{
  "version": 2,
  "exportedAt": "2026-11-19T12:00:00.000Z",
  "records": [],
  "history": [],
  "paymentSettings": {
    "defaultBankCode": "341",
    "customBankUrl": "",
    "supplierPixKeys": {}
  },
  "files": [
    {
      "key": "boleto:...",
      "fileName": "boleto.pdf",
      "fileType": "application/pdf",
      "kind": "boleto",
      "dataBase64": "..."
    }
  ]
}
```
- **Restauração compatível**: a importação aceita tanto backups **v1** (apenas `records` e `history`) quanto **v2** (regravando também os anexos no IndexedDB e `paymentSettings`).
- Antes de substituir os dados atuais, o sistema exige confirmação explícita e guarda uma cópia de segurança em `localStorage["argon_backup_pre_restauracao"]`.

## Estrutura do pacote

```text
argon-boletos-xml/
├── index.html                  # Interface principal (CSP restritiva + PWA)
├── app.js                      # Lógica da aplicação (sem scripts inline)
├── style.css                   # CSS estático compilado (100% offline)
├── fonts/                      # Fontes locais WOFF2 (Inter 400–800 + Mono)
├── manifest.json               # Manifesto PWA
├── sw.js                       # Service Worker (stale-while-revalidate)
├── icon.svg                    # Ícone vetorial
├── main.js                     # Processo principal Electron
├── package.json                # Scripts npm e configuração electron-builder
├── tailwind.config.js          # Configuração Tailwind CLI
├── input.css                   # Entrada CSS para build:css
├── .gitignore                  # Proteção contra envio de backups e node_modules
├── Iniciar_Argon_Windows.bat   # Atalho Windows
├── iniciar_argon.sh            # Atalho Linux/macOS
├── Publicar_no_GitHub.bat      # Publicação interativa privada (Windows)
├── publicar_no_github.sh       # Publicação interativa privada (Linux/macOS)
└── exemplos/
    ├── exemplo_nfe_duplicatas.xml
    ├── popular_2000_boletos.js
    └── test_argon.mjs
```

## Licença

MIT
