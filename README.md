# ARTTOOLS — Precision Pen | Série 01

Landing page estática de alta precisão para a **ArtTools Precision Pen**, construída sobre o sistema visual *Digital Architect v2.0* com scrubbing de 192 frames WebP via `<canvas>`, GSAP 3.13 + ScrollTrigger, SplitText, Lenis e bancada digital interativa `0.1mm`.

## Estrutura do Projeto

```text
artools/
├── index.html          # Página principal (SEO, Open Graph, estrutura semântica)
├── css/
│   └── styles.css      # Estilos do design system e animações das 4 dobras
├── js/
│   └── main.js         # Scrubbing em canvas, ScrollTrigger, bancada 0.1mm e UI
├── assets/
│   ├── fonts/          # Tipografias locais (Inter, Space Grotesk, JetBrains Mono)
│   ├── frames/         # 192 quadros WebP da sequência Hero
│   ├── images/         # Imagens otimizadas e favicon.svg
│   ├── videos/         # Vídeo em loop de produção (pen-showcase.mp4)
│   ├── raw_files/      # Arquivos originais brutos de estúdio (fora do deploy)
│   └── templates/      # Templates e design-system4 de referência (fora do deploy)
├── .gitignore
└── .vercelignore
```

## Execução Local

Por ser um site estático sem etapa de build, basta servir a raiz com qualquer servidor HTTP local:

```bash
npx serve .
# ou
python -m http.server 8080
```

## Deploy

Pronto para deploy direto (sem build command / diretório raiz `.`) em **Vercel**, **Netlify**, **Cloudflare Pages** ou **GitHub Pages**.
O arquivo `.vercelignore` já exclui `assets/raw_files/` e `assets/templates/` do upload de produção na Vercel.

