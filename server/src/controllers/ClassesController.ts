import { Request, Response, NextFunction } from 'express';

import db from "../database/connection";
import convertHourToMinutes from "../utils/convertHoursToMinutes";

interface ScheduleItem {
    week_day: number;
    from: string;
    to: string;
}

interface Filters {
    time?: string;
    subject?: string;
    week_day?: number;
}

export default class ClassesController {

    async index(req: Request, res: Response, next: NextFunction) {
        const filters: Filters = req.query;

        if (!filters.week_day || !filters.subject || !filters.time) {
            return res.status(400).json({
                error: 'Missing filters to search classes'
            })
        }

        const timeInMinutes = convertHourToMinutes(filters.time);

        const classes = await db('classes')
            .whereExists(function () {
                this.select('class_schedule.*')
                    .from('class_schedule')
                    .whereRaw('`class_schedule`.`class_id` = `classes`.`id`')
                    .whereRaw('`class_schedule`.`week_day` = ??', [Number(filters.week_day)])
                    .whereRaw('`class_schedule`.`from` <= ??', [timeInMinutes])
                    .whereRaw('`class_schedule`.`to` > ??', [timeInMinutes])
            })
            .where('classes.subject', '=', filters.subject)
            .join('users', 'classes.user_id', '=', 'users.id')
            .select(['classes.*', 'users.*']);

        res.json(classes);
    }

    async create(req: Request, res: Response, next: NextFunction) {
        const {
            name,
            avatar,
            whatsapp,
            bio,
            subject,
            cost,
            schedule
        } = req.body;

        /** A transaction é responsável por realizar todas as operações no banco de uma vez, dessa forma, se alguma delas falhar
        * todas as que já haviam sido realizadas serão revertidas
        */
        const trx = await db.transaction();

        try {

            const insertedUsersIds = await trx('users').insert({
                name,
                avatar,
                whatsapp,
                bio
            });

            const user_id = insertedUsersIds[0];

            const insertedClassesIds = await trx('classes').insert({
                subject,
                cost,
                user_id
            })

            const class_id = insertedClassesIds[0];

            const classSchedule = schedule.map((scheduleItem: ScheduleItem) => ({
                class_id,
                week_day: scheduleItem.week_day,
                from: convertHourToMinutes(scheduleItem.from),
                to: convertHourToMinutes(scheduleItem.to)
            }))

            await trx('class_schedule').insert(classSchedule);

            // Nesse momento, insere tudo ao mesmo tempo no banco
            await trx.commit();

            return res.send(201).send();

        } catch (err) {

            // Nesse momento, reverte tudo o que tinha sido feito no banco
            await trx.rollback();

            console.error(err)

            return res.status(400).json({
                error: 'Unexpeted error while creating new class'
            })
        }
    }
}