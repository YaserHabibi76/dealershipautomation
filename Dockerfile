# Playwright's own image ships Chromium + every OS-level dependency it needs
# pre-installed and version-matched — far more reliable than installing headless
# Chromium's system libraries by hand on a generic Node buildpack.
FROM mcr.microsoft.com/playwright:v1.61.1-jammy

WORKDIR /app

COPY package*.json ./
RUN npm install --omit=dev

COPY contact_form_bot/package*.json ./contact_form_bot/
RUN npm install --omit=dev --prefix contact_form_bot

COPY . .

ENV NODE_ENV=production
EXPOSE 4173
CMD ["npm", "start"]
