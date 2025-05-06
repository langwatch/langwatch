import type { Snippet } from "../types";

/**
 * Returns code snippets for getting prompts from the LangWatch API
 * @param promptId - The ID of the prompt to retrieve (defaults to "{id}")
 * @param apiKey - The API key to use for authentication (defaults to "YOUR_API_KEY")
 * @returns Array of code snippets for getting prompts
 */
export function getGetPromptSnippets(params?: {
  promptId?: string;
  apiKey?: string;
}): Snippet[] {
  const { promptId = "{id}", apiKey = "YOUR_API_KEY" } = params ?? {};

  return [
    {
      content: `
curl --request GET \
  --url https://app.langwatch.ai/api/prompts/${promptId} \
  --header 'X-Auth-Token: ${apiKey}'
`,
      target: "shell_curl",
      title: "Get Prompts",
    },
    {
      content: `
import requests

url = "https://app.langwatch.ai/api/prompts/${promptId}"

headers = {"X-Auth-Token": "${apiKey}"}

response = requests.request("GET", url, headers=headers)

print(response.text)
`,
      target: "python_requests",
      title: "Get Prompts",
    },
    {
      content: `
const options = {method: 'GET', headers: {'X-Auth-Token': '${apiKey}'}};

fetch('https://app.langwatch.ai/api/prompts/${promptId}', options)
  .then(response => response.json())
  .then(response => console.log(response))
  .catch(err => console.error(err));
`,
      target: "node_native",
      title: "Get Prompts",
    },
    {
      content: `
<?php

$curl = curl_init();

curl_setopt_array($curl, [
  CURLOPT_URL => "https://app.langwatch.ai/api/prompts/${promptId}",
  CURLOPT_RETURNTRANSFER => true,
  CURLOPT_ENCODING => "",
  CURLOPT_MAXREDIRS => 10,
  CURLOPT_TIMEOUT => 30,
  CURLOPT_HTTP_VERSION => CURL_HTTP_VERSION_1_1,
  CURLOPT_CUSTOMREQUEST => "GET",
  CURLOPT_HTTPHEADER => [
    "X-Auth-Token: ${apiKey}"
  ],
]);

$response = curl_exec($curl);
$err = curl_error($curl);

curl_close($curl);

if ($err) {
  echo "cURL Error #:" . $err;
} else {
  echo $response;
}
`,
      target: "php_curl",
      title: "Get Prompts",
    },
    {
      content: `
package main

import (
	"fmt"
	"io/ioutil"
	"net/http"
)

func main() {
	url := "https://app.langwatch.ai/api/prompts/${promptId}"

	req, _ := http.NewRequest("GET", url, nil)
	req.Header.Add("X-Auth-Token", "${apiKey}")

	res, _ := http.DefaultClient.Do(req)
	defer res.Body.Close()
	
	body, _ := ioutil.ReadAll(res.Body)

	fmt.Println(res)
	fmt.Println(string(body))
}
`,
      target: "go_native",
      title: "Get Prompts",
    },
    {
      content: `
import com.mashape.unirest.http.HttpResponse;
import com.mashape.unirest.http.Unirest;
import com.mashape.unirest.http.exceptions.UnirestException;

public class GetPrompt {
    public static void main(String[] args) {
        try {
            HttpResponse<String> response = Unirest.get("https://app.langwatch.ai/api/prompts/${promptId}")
                .header("X-Auth-Token", "${apiKey}")
                .asString();
            
            System.out.println(response.getBody());
        } catch (UnirestException e) {
            e.printStackTrace();
        }
    }
}
`,
      target: "java_unirest",
      title: "Get Prompts",
    },
  ];
}
