FROM node:20-alpine

WORKDIR /app

# Installer avhengigheter
COPY package*.json ./
RUN npm ci --omit=dev

# Kopier kildekode
COPY . .

# Opprett uploads-mappe
RUN mkdir -p uploads

EXPOSE 3000

CMD ["node", "src/app.js"]
