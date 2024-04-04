#! /usr/bin/env node

import chalk from "chalk";
import { program } from "commander";
import { addDays } from "date-fns";
import moment from "moment";
import cron from "node-cron";
import * as readline from "node:readline/promises";

let PHPSESSID = process.env.PHPSESSID;
let noServiceCount = 0;
let availability_mdq = {};
let availability_bue = {};
program.command("list <origen> [days]").action(list);

program.command("notify [hourly]").action(notify);

program.command("server").action(server);

async function server() {
  await ensureSessionId();
  (function keepProcessRunning() {
    setTimeout(keepProcessRunning, 1 << 30);
  })();
  console.log("Server running");
  cron.schedule("7 * * * *", async () => {
    console.log("Running every hour");
    await notify("hourly");
  });
  cron.schedule("7 0 * * *", async () => {
    console.log("Running every day at 00:03");
    await notify();
  });
  cron.schedule("*/5 * * * *", async () => {
    console.log("Running every 5 minutes");
    await notify("hourly");
  });
  // cron.schedule("* * * * *", async () => {
  //   console.log("Running every minute");
  //   await notify("cookies");
  // });

  //once a month
  cron.schedule("59 23 * */1 *", async () => {
    console.log("Running once a month");
    availability_bue = {};
    availability_mdq = {};
  });

  console.log("PHPSESSID", PHPSESSID);
  // await notify("cookies");
}

async function ensureSessionId() {
  if (!PHPSESSID) {
    console.log(
      chalk.red(
        "Debe especificar un PHPSESSID. Puede obtenerlo desde las cookies de la página de ventas de trenes"
      )
    );
    const r1 = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });

    const reply = await r1.question(`PHPSESSIONID?`);
    if (!reply.length) {
      await ensureSessionId();
      return;
    }
    PHPSESSID = reply;
  }
}

async function notify(config) {
  await ensureSessionId();
  console.log(availability_bue);
  console.log(availability_mdq);
  let onlyNotifySuccess = false;
  let onlyNotifyCookies = false;
  if (config === "hourly") {
    console.log(chalk.bold("Notificando solo si hay asientos disponibles"));
    onlyNotifySuccess = true;
  } else if (config === "cookies") {
    console.log(chalk.bold("Notificando solo si no hay servicios disponibles"));
    onlyNotifyCookies = true;
  }
  const days = 30; //TODO: change to 30 or something
  const today = new Date();
  console.log(
    chalk.bold(
      `Buscando asientos disponibles en los próximos ${days} días para notificar`
    )
  );
  const endDate = addDays(today, Number(days) ?? 1);

  let formattedToday = moment(today).format("DD/MM/YYYY");
  let formattedEndDate = moment(endDate).format("DD/MM/YYYY");
  console.log(`Today: ${formattedToday}`);
  console.log(`End Date: ${formattedEndDate}`);
  let activeDate = today;
  let sentido = 1;
  console.log(chalk.bold("Origen: MDQ"));
  let nonEmptySeats = [];
  noServiceCount = 0;
  let entriesSearched = 0;
  while (activeDate <= endDate) {
    entriesSearched += 1;
    let formattedDate = moment(activeDate).format("DD/MM/YYYY");
    console.log(chalk.bold(`Buscando Fecha: ${formattedDate}`));
    const seats = await fetchDate(formattedDate, sentido);
    nonEmptySeats = [
      ...nonEmptySeats,
      {
        date: formattedDate,
        seats: seats.reduce((p, c) => p + c.disponibilidad, 0),
        origen: "MDQ",
      },
    ];
    await sleep(100);
    activeDate = addDays(activeDate, 1);
  }
  const newSeatsMdq = nonEmptySeats.filter((element) => {
    let previousAvailability = availability_mdq[element.date];
    let currentAvailability = element.seats > 0;
    if (previousAvailability !== currentAvailability) {
      availability_mdq[element.date] = currentAvailability;
      if (currentAvailability) {
        return true;
      }
    }
    return false;
  });
  if (!onlyNotifyCookies && newSeatsMdq.length) {
    fetch("https://ntfy.sh/trains_mdq", {
      method: "POST", // PUT works too
      headers: {
        Title: "MDQ -> BUE",
      },
      body: `Asientos disponibles para el ${newSeatsMdq
        .map((a) => `${a.date}: ${a.seats}`)
        .join(`, `)}`,
    });
  }
  if (
    !onlyNotifyCookies &&
    !onlyNotifySuccess &&
    (!nonEmptySeats.length || nonEmptySeats.every((a) => a.seats === 0))
  ) {
    fetch("https://ntfy.sh/trains_mdq", {
      method: "POST", // PUT works too
      body: `MDQ -> BUE: No hay asientos disponibles para los próximos ${days} días`,
    });
  }
  nonEmptySeats = [];
  console.log(chalk.bold("Origen: BUE"));
  sentido = 2;
  activeDate = today;
  while (activeDate <= endDate) {
    entriesSearched += 1;
    let formattedDate = moment(activeDate).format("DD/MM/YYYY");
    console.log(chalk.bold(`Buscando Fecha: ${formattedDate}`));
    const seats = await fetchDate(formattedDate, sentido);
    nonEmptySeats = [
      ...nonEmptySeats,
      {
        date: formattedDate,
        seats: seats.reduce((p, c) => p + c.disponibilidad, 0),
        origen: "MDQ",
      },
    ];
    await sleep(100);
    activeDate = addDays(activeDate, 1);
  }
  const newSeatsBue = nonEmptySeats.filter((element) => {
    let previousAvailability = availability_bue[element.date];
    let currentAvailability = element.seats > 0;
    if (previousAvailability !== currentAvailability) {
      availability_bue[element.date] = currentAvailability;
      if (currentAvailability) {
        return true;
      }
    }
    return false;
  });
  if (!onlyNotifyCookies && newSeatsBue.length) {
    fetch("https://ntfy.sh/trains_bue", {
      method: "POST", // PUT works too
      headers: {
        Title: "BUE -> MDQ",
      },
      body: `Asientos disponibles para el ${newSeatsBue
        .map((a) => `${a.date}: ${a.seats}`)
        .join(`, `)}`,
    });
  }
  if (
    !onlyNotifyCookies &&
    !onlyNotifySuccess &&
    (!nonEmptySeats.length || nonEmptySeats.every((a) => a.seats === 0))
  ) {
    fetch("https://ntfy.sh/trains_bue", {
      method: "POST", // PUT works too
      body: `BUE -> MDQ: No hay asientos disponibles para los próximos ${days} días`,
    });
  }
  if (noServiceCount === entriesSearched) {
    console.log("COOKIE MIGHT BE OUTDATED");
    fetch("https://ntfy.sh/trains_error", {
      method: "POST", // PUT works too
      body: `Cookie might be out of date`,
    });
  }
  console.log(
    `noServiceCount=${noServiceCount} entriesSearched=${entriesSearched}`
  );
  noServiceCount = 0;
  entriesSearched = 0;
}

async function list(arg1, arg2) {
  await ensureSessionId();
  let origen = arg1;
  let days = arg2 ?? 30;
  console.log(arg1);
  console.log(arg2);
  if (!origen) {
    console.log(chalk.red("Debe especificar un origen"));
    return;
  }
  if (origen !== "MDQ" && origen !== "BUE") {
    console.log(chalk.red("Origen no válido. Debe ser MDQ o BUE"));
    return;
  }
  const sentido = origen === "MDQ" ? 1 : 2;
  const today = new Date();
  console.log(
    chalk.bold(
      `Buscando asientos disponibles en los próximos ${days} días - Origen: ${origen}`
    )
  );
  const endDate = addDays(today, Number(days) ?? 1);

  let formattedToday = moment(today).format("DD/MM/YYYY");
  let formattedEndDate = moment(endDate).format("DD/MM/YYYY");
  console.log(`Today: ${formattedToday}`);
  console.log(`End Date: ${formattedEndDate}`);
  let activeDate = today;
  while (activeDate <= endDate) {
    let formattedDate = moment(activeDate).format("DD/MM/YYYY");
    console.log(chalk.bold(`Buscando Fecha: ${formattedDate}`));
    await fetchDate(formattedDate, sentido);
    await sleep(100);
    activeDate = addDays(activeDate, 1);
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function fetchDate(date, sentido) {
  const formData = new FormData();
  formData.append("fecha_seleccionada", date);
  formData.append("sentido", `${sentido}`);
  return fetch(
    "https://webventas.sofse.gob.ar/ajax/servicio/obtener_servicios.php",
    {
      headers: {
        Cookie: `PHPSESSID=${PHPSESSID}`,
      },
      body: formData,
      method: "POST",
    }
  )
    .then((response) => response.json())
    .then((data) => {
      if (data.status !== 1) {
        console.log(data);
        console.log(chalk.red("NO HAY SERVICIO DEFINIDO"), ` -- fecha ${date}`);
        noServiceCount += 1;
        return [];
      }
      console.log(chalk.green("SERVICIO DEFINIDO"), ` -- fecha ${date}`);

      const serviciosOrigen = Object.values(data.servicios);
      const serviciosDestino = serviciosOrigen.map((aServicio) =>
        Object.values(aServicio.servicios)
      );
      const asientosDisponibles = serviciosDestino.reduce((p, c) => {
        const webKeys = Object.keys(c[0].web);

        return [
          ...p,
          ...webKeys.map((key) => {
            return { key, disponibilidad: c[0].web[key].disponibilidad };
          }),
        ];
      }, []);
      const nonEmptySeats = asientosDisponibles.filter((a) => {
        console.log(a);
        return a.disponibilidad > 0;
      });
      if (!nonEmptySeats.length) {
        console.log(chalk.red("SIN ASIENTOS"), ` -- fecha ${date}`);
      }
      nonEmptySeats.forEach((element) => {
        console.log(
          chalk.green(`Servicio: ${element.key}`),
          ` -- Asientos disponibles: ${element.disponibilidad}`
        );
      });
      return nonEmptySeats;
    });
}

program.parse();
