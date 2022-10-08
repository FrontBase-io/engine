const { MongoClient } = require('mongodb')
require('dotenv').config()
const client = new MongoClient(process.env.MONGO_URL)

import { ModelType } from './Types/Models'

import Formula from 'frontbase-formulas-server'
import asyncMap from './helpers/asyncMap'
import { ObjectId } from 'mongodb'

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
  let modelMap: { [key: string]: ModelType } = {}

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
  models.forEach((model) => (modelMap[model.key] = model))

  // 🧪 Formulas
  // Loop through all models to find fields that are formulasmodels.forEach(
  models.map((model: ModelType) => {
   Object.keys(model.fields ?? {}).forEach((fieldKey) => {
    const field = model.fields[fieldKey]
    if (field.settings?.formula) {
     // Create formula instance
     const formula = new Formula(
      field.settings?.formula,
      `${model.label_plural}: ${field.name}`,
      model.key,
      modelMap,
      db
     )

     formula.onReady.then(() => {
      const formulaRef = `${model.key}.${fieldKey}`

      // Store dependencies as field triggers
      formula.dependencies.map((dep) => {
       if (!fieldTriggers[dep.model]) fieldTriggers[dep.model] = {}
       if (!fieldTriggers[dep.model][dep.field])
        fieldTriggers[dep.model][dep.field] = []
       fieldTriggers[dep.model][dep.field].push({
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
       async (triggeredEffect) => {
        // Formula
        if (triggeredEffect.type === 'formula') {
         if (formulas[triggeredEffect.formulaId]) {
          const formula = formulas[triggeredEffect.formulaId]

          if (formula.isInstant) {
           // Todo: move to before save action
           formula.compileWithObject(change.fullDocument).then((result) => {
            console.log(
             `🧪 [${formula.label}] Instant formula calculation for ${result} (${change.documentKey._id}).`
            )

            // Update
            db
             .collection('Objects')
             .updateOne(
              { _id: change.documentKey._id },
              { $set: { [triggeredEffect.formulaResult]: result } }
             )
           })
          } else {
           // This is a remote dependency. We first need to find what objects are affected by this change.
           const affectedObjectIds = []
           const hierarchy = formula.dependencies.find(
            (d) =>
             d.model === change.fullDocument._meta.modelId &&
             Object.keys(change.updateDescription.updatedFields).some(
              (f) => d.field === f
             )
           )

           // Loop through the hierarchy and find all the objects

           if (hierarchy.parents.length === 0) {
            // We have no parents, this means the highgest level of a remote formula was triggerd
            // Add only the current object to the affected list.
            affectedObjectIds.push(change.documentKey._id)
           } else {
            // We have parents to traverse. Do this to find what objects are affected by this change
            let objectIds = [change.documentKey._id.toString()]
            await asyncMap(
             hierarchy.parents,
             async (hierarchyLevel, hierarchyIndex) => {
              let modelId = hierarchyLevel.model
              let fieldId = hierarchyLevel.field
              const oldObjectIds = [...objectIds]
              objectIds = []

              await asyncMap(
               await db
                .collection('Objects')
                .find({
                 '_meta.modelId': modelId,
                 [fieldId]: { $in: oldObjectIds },
                })
                .toArray(),
               (obj) => {
                if (hierarchyIndex === hierarchy.parents.length - 1) {
                 // If this is the last level of the hierarchy, we add it to the found object IDs array
                 affectedObjectIds.push(obj._id)
                } else {
                 // Intermediate step
                 // We store the object id into an array we use to go one level deeper into the hierarchy
                 objectIds.push(obj._id.toString())
                }
               }
              )
             }
            )
           }

           // Now loop through the affected objects and calculate the formula for that object
           if (affectedObjectIds.length > 0) {
            console.log(
             `🧪 [${
              formula.label
             }] Remote formula calculation for ${affectedObjectIds.join(', ')}.`
            )
            await asyncMap(
             await db
              .collection('Objects')
              .find({
               _id: { $in: affectedObjectIds },
              })
              .toArray(),
             (object) => {
              formula.compileWithObject(object).then((result) => {
               console.log(`🧪 [${formula.label}] ---> ${result}`)

               // Update
               db
                .collection('Objects')
                .updateOne(
                 { _id: new ObjectId(object._id) },
                 { $set: { [triggeredEffect.formulaResult]: result } }
                )
              })
             }
            )
           } else {
            console.log(
             `🧪 [${formula.label}] Remote calculation triggered, but no objects were affected.`
            )
           }
          }
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
