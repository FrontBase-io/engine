const { MongoClient } = require('mongodb')
require('dotenv').config()
const client = new MongoClient(process.env.MONGO_URL)

import { ModelType } from './Types/Models'

import Formula from 'frontbase-formulas-server'

async function main() {
 await client.connect()
 console.log('🍃 Mongo connection succesful.')
 const db = client.db('FrontBase')
 const initialisedFlag = await db
  .collection('Objects')
  .findOne({ '_meta.modelId': 'user' })

 if (initialisedFlag) {
  console.log('🏍️  Initialising engine')

  // Keep an overview of models to prevent from constantly having to load these from the database
  let models: ModelType[] = []

  // Keeps track of compiled formulas
  const formulas: { [key: string]: Formula } = {}

  // Keeps tracks of field triggers
  const fieldTriggers: {
   [modelKey: string]: {
    [fieldKey: string]: {
     type: 'formula' | 'process'
     formulaId?: string
     formulaResult?: string
    }[]
   }
  } = {}

  // Load all models
  models = await db.collection('Models').find().toArray()

  // 🧪 Formulas
  // Loop through all models to find fields that are formulasmodels.forEach(
  models.map((model: ModelType) => {
   Object.keys(model.fields ?? {}).forEach((fieldKey) => {
    const field = model.fields[fieldKey]
    if (field.settings?.formula) {
     const formula = new Formula(field.settings?.formula, field.name)

     formula.onReady.then(() => {
      const formulaRef = `${model.key}.${fieldKey}`

      // Store dependencies as field triggers
      formula.dependencies.map((dep) => {
       if (!fieldTriggers[model.key]) fieldTriggers[model.key] = {}
       if (!fieldTriggers[model.key][dep.key])
        fieldTriggers[model.key][dep.key] = []
       fieldTriggers[model.key][dep.key].push({
        type: 'formula',
        formulaId: formulaRef,
        formulaResult: fieldKey,
       })
      })

      // Store formula
      formulas[formulaRef] = formula
     })
    }
   })
  })

  // ... more things we need to do

  // Object change listeners
  db
   .collection('Objects')
   .watch({ fullDocument: 'updateLookup' })
   .on('change', async (change) => {
    const changedFields = Object.keys(change.updateDescription.updatedFields)

    // On object change
    changedFields.map((changedFieldKey) => {
     if (fieldTriggers[change.fullDocument._meta.modelId]?.[changedFieldKey]) {
      // If we have one or more effects triggered, fire all the events.
      fieldTriggers[change.fullDocument._meta.modelId]?.[changedFieldKey].map(
       (triggeredEffect) => {
        // Formula
        if (triggeredEffect.type === 'formula') {
         if (formulas[triggeredEffect.formulaId]) {
          const formula = formulas[triggeredEffect.formulaId]

          formula.compileWithObject(change.fullDocument).then((result) => {
           // Update
           db
            .collection('Objects')
            .updateOne(
             { _id: change.documentKey._id },
             { $set: { [triggeredEffect.formulaResult]: result } }
            )
          })
         }
        }

        // Todo: other (processes, more?)
       }
      )
     }
    })
   })
 } else {
  console.log(
   `Engine didn't start, because the application hasn't been initialised yet.`
  )
 }
}
main()
