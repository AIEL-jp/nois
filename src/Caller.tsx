import React from "react";
import App from "./App";

// App.tsxのロジックをCaller用に使う。roleを"caller"で固定
export default function Caller(props: any) {
  return <App forcedRole="caller" {...props} />;
}
