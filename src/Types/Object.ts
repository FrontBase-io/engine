export interface ObjectType {
  _id: string
  _meta: { modelId: string }
  [key: string]: any
}

export interface NewObjectType {
  [key: string]: any
}
