import { Context, h, Schema } from 'koishi'

export const name = 'daily-news'

export const inject = {
    required: ['database']
}

export interface DailyNewsSub {
    id: number
    channelID: string
    platform: string
}

declare module 'koishi' {
    interface Tables {
        'daily-news-sub-list': DailyNewsSub
    }
}

export interface Config {
    time: string
    authority: number
}

export const Config: Schema<Config> = Schema.object({
    time: Schema.string()
        .pattern(/(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d/gm)
        .default('08:00:00').description('默认每日新闻发布时间'),
    authority: Schema.number().default(2).description('订阅新闻权限等级')
})

class DailyNews {
    constructor(ctx: Context, config: Config) {
        // 迁移数据库
        ctx.model.extend('daily-news-sub-list', {
            id: 'unsigned',
            channelID: 'string',
            platform: 'string',
        })

        // 注册指令
        ctx.command('news', '获取每日新闻')
            .usage('跟去一张每日新闻概要图片')
            .example('news')
            .action(async () => {
                return h('img', { src: await DailyNews.getNews(ctx) })
            })

        ctx.command('subnews', '订阅每日新闻')
            .alias('订阅新闻')
            .option('cancel', '-c 取消订阅', { fallback: false, authority: config.authority })
            .usage(`每日 ${config.time} 发送一张每日新闻概要图片`)
            .example('subnews')
            .example('subnews -c')
            .action(async ({ options, session }) => {
                switch (options.cancel) {
                    case true: {
                        const res = await ctx.database.remove('daily-news-sub-list', {
                            channelID: session.channelId,
                            platform: session.platform,
                        })
                        if (res.removed > 0) {
                            return '取消订阅成功'
                        }
                        return '取消订阅失败或未订阅'
                    }
                    case false: {
                        const res = await ctx.database.upsert('daily-news-sub-list', [{
                            channelID: session.channelId,
                            platform: session.platform,
                        }],
                            ['channelID', 'platform']
                        )
                        if (res.inserted > 0) {
                            return '订阅成功'
                        }
                        return '订阅失败或已订阅'
                    }
                }
            })

        // 定时任务
        ctx.setTimeout(async function postNews() {
            const [apiResp, waitingList] = await Promise.all([
                DailyNews.getNews(ctx),
                ctx.database.select('daily-news-sub-list').execute()
            ])
            if (waitingList.length == 0) return

            let sendList = []
            waitingList.forEach(async (item: DailyNewsSub) => {
                ctx.bots.forEach((bot) => {
                    if (bot.platform != item.platform) return
                    sendList.push(bot.sendMessage(item.channelID, h('img', { src: apiResp })))
                })
            })

            Promise.allSettled(sendList)

            await ctx.sleep(1000)
            ctx.setTimeout(postNews, DailyNews.calcIntervalTime(config))
        }, DailyNews.calcIntervalTime(config))
    }

    // 获取新闻
    static async getNews(ctx: Context): Promise<string> {
        const resp = await ctx.http.get('http://dwz.2xb.cn/zaob')
        if (resp.code != 200) {
            throw new Error('获取新闻失败')
        }
        return resp.imageUrl
    }

    // 计算下一次发布时间
    static calcIntervalTime(config: Config): number {
        const now = new Date()
        const postTime = new Date()

        const targetTime: [number, number, number] = [8, 0, 0]
        config.time.split(':').forEach((v: string, i: number) => {
            targetTime[i] = parseInt(v)
        })
        postTime.setHours(...targetTime)

        let intervalTime = postTime.getTime() - now.getTime()
        if (intervalTime < 0) {
            postTime.setDate(postTime.getDate() + 1)
            intervalTime = postTime.getTime() - now.getTime()
        }

        return intervalTime
    }
}

export function apply(ctx: Context, config: Config) {
    ctx.plugin(DailyNews, config)
}
