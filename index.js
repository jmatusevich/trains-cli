#! /usr/bin/env node

import chalk from "chalk"; 
import {program} from 'commander';
import { addDays } from 'date-fns';
import moment from 'moment';

program.command('list <origen> [days]')
.action(list)

program.command('notify [hourly]')
.action(notify)

async function notify(hourly) {
    let onlyNotifySuccess = false
    if (hourly === 'hourly') {
        console.log(chalk.bold('Notificando solo si hay asientos disponibles'))
        onlyNotifySuccess = true
    }
    const days = 60
    const today = new Date()
    console.log(chalk.bold(`Buscando asientos disponibles en los próximos ${days} días para notificar`))
    const endDate = addDays(today, Number(days) ?? 1)

    let formattedToday = moment(today).format('DD/MM/YYYY')
    let formattedEndDate = moment(endDate).format('DD/MM/YYYY')
    console.log(`Today: ${formattedToday}`)
    console.log(`End Date: ${formattedEndDate}`)
    let activeDate = today
    let sentido = 1
    console.log(chalk.bold("Origen: MDQ"))
    let nonEmptySeats = []
    while(activeDate <= endDate) {
        let formattedDate = moment(activeDate).format('DD/MM/YYYY')
        console.log(chalk.bold(`Buscando Fecha: ${formattedDate}`))
        const seats = await fetchDate(formattedDate, sentido)
        nonEmptySeats = [...nonEmptySeats, {date: formattedDate, seats: seats.reduce((p, c) => p + c.disponibilidad, 0), origen: "MDQ"}]
        await sleep(100)
        activeDate = addDays(activeDate, 1)
    }
    nonEmptySeats.forEach(element => {
        if (element.seats > 0) {
            fetch('https://ntfy.sh/trains_mdq', {
                method: 'POST', // PUT works too
                body: `MDQ -> BUE: Asientos disponibles para ${element.date}: ${element.seats}`,
            })
        }
    });
    if (!onlyNotifySuccess && (!nonEmptySeats.length || nonEmptySeats.every(a => a.seats === 0))) {
        fetch('https://ntfy.sh/trains_mdq', {
            method: 'POST', // PUT works too
            body: `MDQ -> BUE: No hay asientos disponibles para los próximos ${days} días`,
        })
    }
    nonEmptySeats = []
    console.log(chalk.bold("Origen: BUE"))
    sentido = 2
    activeDate = today
    while(activeDate <= endDate) {
        let formattedDate = moment(activeDate).format('DD/MM/YYYY')
        console.log(chalk.bold(`Buscando Fecha: ${formattedDate}`))
        const seats = await fetchDate(formattedDate, sentido)
        nonEmptySeats = [...nonEmptySeats, {date: formattedDate, seats: seats.reduce((p, c) => p + c.disponibilidad, 0), origen: "MDQ"}]
        await sleep(100)
        activeDate = addDays(activeDate, 1)
    }
    nonEmptySeats.forEach(element => {
        if (element.seats > 0) {
            fetch('https://ntfy.sh/trains_mdq', {
                method: 'POST', // PUT works too
                body: `BUE -> MDQ: Asientos disponibles para ${element.date}: ${element.seats}`,
            })
        }
    });
    if (!onlyNotifySuccess && (!nonEmptySeats.length || nonEmptySeats.every(a => a.seats === 0))) {
        fetch('https://ntfy.sh/trains_bue', {
            method: 'POST', // PUT works too
            body: `BUE -> MDQ: No hay asientos disponibles para los próximos ${days} días`,
        })
    }
}

async function list(days = 30, origen) {
    if (!origen) {
        console.log(chalk.red('Debe especificar un origen'))
        return
    }
    if (origen !== 'MDQ' && origen !== 'BUE') {
        console.log(chalk.red('Origen no válido. Debe ser MDQ o BUE'))
        return
    }
    const sentido = origen === 'MDQ' ? 1 : 2
    const today = new Date()
    console.log(chalk.bold(`Buscando asientos disponibles en los próximos ${days} días - Origen: ${origen}`))
    const endDate = addDays(today, Number(days) ?? 1)

    let formattedToday = moment(today).format('DD/MM/YYYY')
    let formattedEndDate = moment(endDate).format('DD/MM/YYYY')
    console.log(`Today: ${formattedToday}`)
    console.log(`End Date: ${formattedEndDate}`)
    let activeDate = today
    while(activeDate <= endDate) {
        let formattedDate = moment(activeDate).format('DD/MM/YYYY')
        console.log(chalk.bold(`Buscando Fecha: ${formattedDate}`))
        await fetchDate(formattedDate, sentido)
        await sleep(100)
        activeDate = addDays(activeDate, 1)
    }
}

function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

function fetchDate(date, sentido) {
    const formData = new FormData();
    formData.append('fecha_seleccionada', date);
    formData.append('sentido', `${sentido}`);
    return fetch("https://webventas.sofse.gob.ar/ajax/servicio/obtener_servicios.php", {
        "headers": {
            "Cookie": "PHPSESSID=qd4hltvlu7kvussq3o1pc9go01; PHPSESSID=fo709bkmdp8h8kts39lo4qdc35",        
        },
            "body": formData,
            "method": "POST", 
    }).then(response => response.json())
    .then(data => {
        if (data.status !== 1) {
            console.log(chalk.red('NO HAY SERVICIO DEFINIDO'), ` -- fecha ${date}`)
            return []
        }
        const serviciosOrigen = Object.values(data.servicios)
        const serviciosDestino = serviciosOrigen.map(aServicio => Object.values(aServicio.servicios))
        const asientosDisponibles = serviciosDestino.reduce((p, c) => {
            const webKeys = Object.keys(c[0].web)
            return [...p,webKeys.map(key => {
                return {key, disponibilidad: c[0].web[key].disponibilidad}
            })];

        }, [])
        const nonEmptySeats = asientosDisponibles.filter(a => a.disponibilidad > 0)
        if (!nonEmptySeats.length) {
            console.log(chalk.red('SIN ASIENTOS'), ` -- fecha ${date}`)
        }
        nonEmptySeats.forEach(element => {
            console.log(chalk.green(`Servicio: ${element.key}`),` -- Asientos disponibles: ${element.disponibilidad}`)
        });
        return nonEmptySeats
    })
}


program.parse()
