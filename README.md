# The Daily Drop — Paper Reader

A daily paper-reading habit app: one "drop" of papers a day, a 5-minute reading
timer, a streak that only counts when you hit your goal, and a copyable share
line for a paper buddy. Built with React + Vite, installable as a PWA, and
deployed to GitHub Pages.

## Run it locally

```bash
npm install
npm run dev        # http://localhost:5173/paper-reader/
```

## Build

```bash
npm run build      # outputs to dist/
npm run preview    # serve the production build locally
```

## How it works

- **Storage** — streak, queue, added papers, interests, and your reading log are
  saved to the browser's `localStorage`. No backend, persists per-device.
- **Adding papers** — paste an arXiv ID and hit *fetch*; the title, authors,
  abstract, and year autofill from the arXiv API (routed through a CORS proxy,
  since arXiv sends no CORS header). Anything you type by hand wins.
- **Icons** — `npm run icons` regenerates `public/icon-512.png` and
  `public/favicon.svg` with no dependencies; the smaller sizes are downscaled
  with `sips` (macOS).

## Deploy (GitHub Pages, served at abrahamyeung.com/paper-reader)

1. Create a GitHub repo named **`paper-reader`** (the name must match the `base`
   in `vite.config.js`, which is `/paper-reader/`).
2. Push this project to its `main` branch.
3. In the repo: **Settings → Pages → Build and deployment → Source: GitHub
   Actions**.
4. The workflow in `.github/workflows/deploy.yml` builds and deploys on every
   push to `main`.

Because your custom domain (`abrahamyeung.com`) is already attached to your user
Pages site, this project repo is automatically served at
`https://abrahamyeung.com/paper-reader/`. To change the path, edit `base` in
`vite.config.js` (and the matching paths in `index.html`) to match the repo
name.
