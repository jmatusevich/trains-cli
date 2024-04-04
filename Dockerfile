FROM --platform=linux/amd64 node:lts-alpine3.19
RUN mkdir -p /home/node/app/node_modules && chown -R node:node /home/node/app
WORKDIR /home/node/app
COPY package*.json ./
RUN npm install
COPY --chown=node:node . .
RUN npm i -g
CMD [ "trains", "server" ]