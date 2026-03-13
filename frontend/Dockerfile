FROM node:20-alpine

WORKDIR /app

ARG BACKEND_ORIGIN=http://backend:3210
ENV BACKEND_ORIGIN=$BACKEND_ORIGIN

COPY package.json ./
RUN npm install

COPY next.config.js ./
COPY pages ./pages
COPY styles ./styles

RUN npm run build

EXPOSE 3000

CMD ["npm", "start"]
